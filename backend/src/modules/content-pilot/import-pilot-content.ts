import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import type { PrismaClient } from '@prisma/client';

import { canonicalJson } from '../../common/utils/canonical-json';
import {
  formatPilotIssues,
  loadPilotReferenceData,
  normalizePinyinForCompare,
  stripToneMarks,
  validatePilotLesson,
  type PilotContentIssue,
  type PilotReferenceData,
} from './pilot-content.validator';

/**
 * Script nạp nội dung pilot (Pha 2, `docs/process/content-pipeline.md` §3).
 *
 * Trình tự: validate file bằng **cùng** validator của test TL-223 → preflight
 * (Level HSK1, DataSource, slug) → Lesson draft → Topic draft → preview exercise →
 * commit exercise kèm `Idempotency-Key` (TL-216) → `LessonWord` bằng Prisma trong
 * một transaction có `SELECT … FOR UPDATE` (Q179) → kiểm chứng lại.
 *
 * Mọi bản ghi dừng ở `draft`; script không publish, không archive, không chạm
 * Story (Q177). Không đọc `.env`: token và base URL lấy từ environment của tiến
 * trình do người chạy chỉ định (§3). `--dry-run` chỉ đọc, không ghi DB và không
 * gọi endpoint ghi.
 */

export interface PilotImportDependencies {
  /** Ví dụ `http://127.0.0.1:3000/api/v1`. */
  readonly apiBaseUrl: string;
  /** Bearer token của tài khoản admin (§3). */
  readonly adminToken: string;
  readonly prisma: PrismaClient;
  /** Cho test truyền wrapper; mặc định `globalThis.fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly logger?: (line: string) => void;
}

export interface PilotImportOptions {
  /** Đường dẫn tuyệt đối tới `lesson-NN.json`. */
  readonly filePath: string;
  /** Thư mục `backend/` để nạp dữ liệu tham chiếu HSK1. */
  readonly backendRoot: string;
  readonly dryRun: boolean;
}

export interface PilotImportPreviewError {
  readonly rowNumber: number;
  readonly code: string;
  readonly path: string;
}

export interface PilotImportResult {
  readonly dryRun: boolean;
  readonly lessonId: number | null;
  readonly topicIds: Readonly<Record<string, number>>;
  readonly importJobId: number | null;
  readonly importedRows: number;
  readonly idempotent: boolean;
  readonly previewErrors: readonly PilotImportPreviewError[];
  readonly createdLesson: boolean;
  readonly createdTopics: number;
  readonly lessonWordCount: number;
  readonly steps: readonly string[];
}

export class PilotImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'PilotImportError';
  }
}

interface LessonFileTopic {
  readonly key: string;
  readonly type: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly orderIndex: number;
  readonly isPremium: boolean;
  readonly isLocked: boolean;
  readonly content: unknown;
}

interface LessonFileExercise {
  readonly sourceKey: string;
  readonly topicKey: string | null;
  readonly type: string;
  readonly prompt: string;
  readonly content: unknown;
  readonly answer: unknown;
  readonly explanation?: string;
  readonly orderIndex: number;
}

interface LessonFileWord {
  readonly hanzi: string;
  readonly pinyin: string;
}

interface LessonFile {
  readonly lesson: {
    readonly sourceKey: string;
    readonly levelCode: string;
    readonly slug: string;
    readonly title: string;
    readonly description?: string;
    readonly orderIndex: number;
  };
  readonly dataSource: { readonly code: string; readonly version: string };
  readonly words: readonly LessonFileWord[];
  readonly topics: readonly LessonFileTopic[];
  readonly exercises: readonly LessonFileExercise[];
}

interface ApiEnvelope {
  readonly success?: unknown;
  readonly data?: unknown;
  readonly error?: unknown;
}

interface AdminTopicSummary {
  readonly id: number;
  readonly orderIndex: number;
  readonly title: string;
  readonly status: string;
  readonly deletedAt?: string | null;
}

interface ImportPreviewResponse {
  readonly totalRows: number;
  readonly validRows: number;
  readonly invalidRows: number;
  readonly errors: readonly PilotImportPreviewError[];
  readonly previewHash: string;
}

const SOURCE_KEY_ALREADY_EXISTS = 'SOURCE_KEY_ALREADY_EXISTS';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new PilotImportError(
      'invalid_api_response',
      `${what} không phải object`,
    );
  }
  return value;
}

function asArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new PilotImportError(
      'invalid_api_response',
      `${what} không phải mảng`,
    );
  }
  return value;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== 'string') {
    throw new PilotImportError(
      'invalid_api_response',
      `${what} không phải string`,
    );
  }
  return value;
}

function asNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PilotImportError('invalid_api_response', `${what} không phải số`);
  }
  return value;
}

function asBoolean(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') {
    throw new PilotImportError(
      'invalid_api_response',
      `${what} không phải boolean`,
    );
  }
  return value;
}

function assertLessonFile(raw: unknown): LessonFile {
  const record = asRecord(raw, 'file');
  const lesson = asRecord(record.lesson, 'lesson');
  const dataSource = asRecord(record.dataSource, 'dataSource');
  const words = asArray(record.words, 'words').map((word) => {
    const entry = asRecord(word, 'words[]');
    return {
      hanzi: asString(entry.hanzi, 'words[].hanzi'),
      pinyin: asString(entry.pinyin, 'words[].pinyin'),
    };
  });
  const topics = asArray(record.topics, 'topics').map((topic) => {
    const entry = asRecord(topic, 'topics[]');
    return {
      key: asString(entry.key, 'topics[].key'),
      type: asString(entry.type, 'topics[].type'),
      title: asString(entry.title, 'topics[].title'),
      subtitle:
        entry.subtitle === undefined
          ? undefined
          : asString(entry.subtitle, 'topics[].subtitle'),
      orderIndex: asNumber(entry.orderIndex, 'topics[].orderIndex'),
      isPremium: asBoolean(entry.isPremium, 'topics[].isPremium'),
      isLocked: asBoolean(entry.isLocked, 'topics[].isLocked'),
      content: entry.content,
    };
  });
  const exercises = asArray(record.exercises, 'exercises').map((exercise) => {
    const entry = asRecord(exercise, 'exercises[]');
    const topicKey = entry.topicKey ?? null;
    return {
      sourceKey: asString(entry.sourceKey, 'exercises[].sourceKey'),
      topicKey:
        topicKey === null ? null : asString(topicKey, 'exercises[].topicKey'),
      type: asString(entry.type, 'exercises[].type'),
      prompt: asString(entry.prompt, 'exercises[].prompt'),
      content: entry.content,
      answer: entry.answer,
      explanation:
        entry.explanation === undefined
          ? undefined
          : asString(entry.explanation, 'exercises[].explanation'),
      orderIndex: asNumber(entry.orderIndex, 'exercises[].orderIndex'),
    };
  });
  return {
    lesson: {
      sourceKey: asString(lesson.sourceKey, 'lesson.sourceKey'),
      levelCode: asString(lesson.levelCode, 'lesson.levelCode'),
      slug: asString(lesson.slug, 'lesson.slug'),
      title: asString(lesson.title, 'lesson.title'),
      description:
        lesson.description === undefined
          ? undefined
          : asString(lesson.description, 'lesson.description'),
      orderIndex: asNumber(lesson.orderIndex, 'lesson.orderIndex'),
    },
    dataSource: {
      code: asString(dataSource.code, 'dataSource.code'),
      version: asString(dataSource.version, 'dataSource.version'),
    },
    words,
    topics,
    exercises,
  };
}

class ApiClient {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly deps: PilotImportDependencies,
    private readonly log: (line: string) => void,
  ) {
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  }

  async get(path: string): Promise<unknown> {
    return this.request('GET', path);
  }

  async post(
    path: string,
    body: unknown,
    extraHeaders: Readonly<Record<string, string>> = {},
  ): Promise<unknown> {
    return this.request('POST', path, body, extraHeaders);
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    extraHeaders: Readonly<Record<string, string>> = {},
  ): Promise<unknown> {
    const url = `${this.deps.apiBaseUrl.replace(/\/$/, '')}${path}`;
    const response = await this.fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${this.deps.adminToken}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let payload: unknown = null;
    if (text.length > 0) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        throw new PilotImportError(
          'invalid_api_response',
          `${method} ${path} trả JSON không parse được (HTTP ${response.status})`,
        );
      }
    }
    if (!response.ok) {
      const record = isRecord(payload) ? payload : {};
      const error = isRecord(record.error) ? record.error : {};
      const code =
        typeof error.code === 'string' ? error.code : `HTTP_${response.status}`;
      const message =
        typeof error.message === 'string'
          ? error.message
          : `HTTP ${response.status} từ ${method} ${path}`;
      throw new PilotImportError(
        code,
        `${message} (${method} ${path})`,
        error,
        response.status,
      );
    }
    const envelope: ApiEnvelope = isRecord(payload) ? payload : {};
    if (envelope.success !== true) {
      throw new PilotImportError(
        'invalid_api_response',
        `${method} ${path} thiếu success:true`,
      );
    }
    this.log(`${method} ${path} → ${response.status}`);
    return envelope.data;
  }
}

function throwPilotContentIssues(
  issues: readonly PilotContentIssue[],
  fileName: string,
): never {
  throw new PilotImportError(
    'pilot_content_invalid',
    `File ${fileName} vi phạm luật nội dung pilot:\n${formatPilotIssues(
      issues.map((issue) => ({ ...issue, fileName })),
    )}`,
    issues,
  );
}

function idempotencyKey(
  lessonSourceKey: string,
  dataSourceId: number,
  fileName: string,
  rows: readonly unknown[],
): string {
  const digest = createHash('sha256')
    .update(canonicalJson([dataSourceId, fileName, rows]))
    .digest('hex')
    .slice(0, 16);
  const key = `pilot-import:v1:${lessonSourceKey}:${digest}`;
  if (key.length > 128) {
    throw new PilotImportError(
      'idempotency_key_too_long',
      `Idempotency-Key dài ${key.length} > 128`,
    );
  }
  return key;
}

async function findLevelId(api: ApiClient, levelCode: string): Promise<number> {
  const data = await api.get('/levels');
  for (const entry of asArray(data, 'levels')) {
    const record = asRecord(entry, 'levels[]');
    if (record.code === levelCode) return asNumber(record.id, 'levels[].id');
  }
  throw new PilotImportError(
    'level_not_found',
    `Không tìm thấy Level code=${levelCode}`,
  );
}

async function findDataSourceId(
  api: ApiClient,
  code: string,
  version: string,
): Promise<number> {
  const pageSize = 100;
  for (let page = 1; page <= 100; page += 1) {
    const data = await api.get(
      `/admin/cms/data-sources?page=${String(page)}&limit=${String(pageSize)}`,
    );
    const entries = asArray(data, 'data-sources');
    const match = entries
      .map((entry) => asRecord(entry, 'data-sources[]'))
      .find((entry) => entry.code === code && entry.version === version);
    if (match !== undefined) {
      return asNumber(match.id, 'data-sources[].id');
    }
    if (entries.length < pageSize) break;
  }
  throw new PilotImportError(
    'data_source_not_found',
    `Không tìm thấy DataSource code=${code} version=${version}; phải chạy migration Q178 trước`,
  );
}

async function findLessonId(
  api: ApiClient,
  slug: string,
): Promise<{ id: number; status: string } | null> {
  const data = await api.get(
    `/admin/cms/lessons?search=${encodeURIComponent(slug)}&limit=100&page=1`,
  );
  const matches = asArray(data, 'lessons')
    .map((entry) => asRecord(entry, 'lessons[]'))
    .filter((entry) => entry.slug === slug);
  if (matches.length > 1) {
    throw new PilotImportError(
      'lesson_slug_ambiguous',
      `Có ${matches.length} lesson cùng slug ${slug}; dừng để người chạy kiểm tra`,
    );
  }
  const match = matches[0];
  if (match === undefined) return null;
  return {
    id: asNumber(match.id, 'lessons[].id'),
    status: asString(match.status, 'lessons[].status'),
  };
}

async function ensureDraftLesson(
  api: ApiClient,
  lesson: LessonFile['lesson'],
  levelId: number,
  log: (line: string) => void,
): Promise<{ lessonId: number; created: boolean }> {
  const existing = await findLessonId(api, lesson.slug);
  if (existing !== null) {
    if (existing.status !== 'draft') {
      throw new PilotImportError(
        'lesson_not_draft',
        `Lesson slug ${lesson.slug} đã tồn tại với status=${existing.status}; script chỉ làm việc với bản draft`,
      );
    }
    log(`reuse lesson id=${String(existing.id)} slug=${lesson.slug}`);
    return { lessonId: existing.id, created: false };
  }
  const body: Record<string, unknown> = {
    levelId,
    title: lesson.title,
    orderIndex: lesson.orderIndex,
    slug: lesson.slug,
  };
  if (lesson.description !== undefined) body.description = lesson.description;
  const data = asRecord(
    await api.post('/admin/cms/lessons', body),
    'create lesson',
  );
  const createdLesson = asRecord(data.lesson, 'created lesson');
  return {
    lessonId: asNumber(createdLesson.id, 'created lesson.id'),
    created: true,
  };
}

async function ensureDraftTopics(
  api: ApiClient,
  lessonId: number,
  topics: readonly LessonFileTopic[],
  log: (line: string) => void,
): Promise<{ topicIds: Record<string, number>; created: number }> {
  const detail = asRecord(
    await api.get(`/admin/cms/lessons/${String(lessonId)}`),
    'lesson detail',
  );
  const existing = asArray(detail.topics, 'lesson detail.topics')
    .map((entry) => asRecord(entry, 'lesson detail.topics[]'))
    .map(
      (entry) =>
        ({
          id: asNumber(entry.id, 'topics[].id'),
          orderIndex: asNumber(entry.orderIndex, 'topics[].orderIndex'),
          title: asString(entry.title, 'topics[].title'),
          status: asString(entry.status, 'topics[].status'),
          deletedAt:
            typeof entry.deletedAt === 'string' ? entry.deletedAt : null,
        }) satisfies AdminTopicSummary,
    );
  const byOrder = new Map<number, AdminTopicSummary>();
  for (const topic of existing) byOrder.set(topic.orderIndex, topic);

  const topicIds: Record<string, number> = {};
  let created = 0;
  for (const topic of topics) {
    const found = byOrder.get(topic.orderIndex);
    if (found !== undefined) {
      // TL-217: chỉ dùng lại khi khớp title VÀ status=draft.
      if (found.status !== 'draft' || found.deletedAt !== null) {
        throw new PilotImportError(
          'topic_not_draft',
          `Topic orderIndex=${String(topic.orderIndex)} của lesson ${String(lessonId)} có status=${found.status}; dừng`,
        );
      }
      if (found.title !== topic.title) {
        throw new PilotImportError(
          'topic_title_mismatch',
          `Topic orderIndex=${String(topic.orderIndex)} tồn tại với title khác (TL-217): "${found.title}" ≠ "${topic.title}"`,
        );
      }
      log(
        `reuse topic id=${String(found.id)} orderIndex=${String(topic.orderIndex)}`,
      );
      topicIds[topic.key] = found.id;
      continue;
    }
    const body: Record<string, unknown> = {
      lessonId,
      title: topic.title,
      type: topic.type,
      content: topic.content,
      orderIndex: topic.orderIndex,
      isPremium: topic.isPremium,
      isLocked: topic.isLocked,
    };
    if (topic.subtitle !== undefined) body.subtitle = topic.subtitle;
    const data = asRecord(
      await api.post('/admin/cms/topics', body),
      'create topic',
    );
    const createdTopic = asRecord(data.topic, 'created topic');
    topicIds[topic.key] = asNumber(createdTopic.id, 'created topic.id');
    created += 1;
  }
  return { topicIds, created };
}

function buildImportRows(
  exercises: readonly LessonFileExercise[],
  lessonId: number,
  topicIds: Readonly<Record<string, number>>,
): Record<string, unknown>[] {
  return exercises.map((exercise) => {
    const row: Record<string, unknown> = {
      sourceKey: exercise.sourceKey,
      lessonId,
      orderIndex: exercise.orderIndex,
      type: exercise.type,
      prompt: exercise.prompt,
      content: exercise.content,
      answer: exercise.answer,
    };
    if (exercise.topicKey !== null) {
      const topicId = topicIds[exercise.topicKey];
      if (topicId === undefined) {
        throw new PilotImportError(
          'topic_key_dangling',
          `Exercise ${exercise.sourceKey} trỏ topicKey=${exercise.topicKey} chưa được tạo`,
        );
      }
      row.topicId = topicId;
    }
    if (exercise.explanation !== undefined) {
      row.explanation = exercise.explanation;
    }
    return row;
  });
}

async function importExercises(
  api: ApiClient,
  lessonSourceKey: string,
  dataSourceId: number,
  fileName: string,
  rows: readonly Record<string, unknown>[],
  log: (line: string) => void,
): Promise<{
  importJobId: number;
  importedRows: number;
  idempotent: boolean;
  previewErrors: readonly PilotImportPreviewError[];
  previewHash: string;
}> {
  const previewBody = { dataSourceId, fileName, rows };
  const preview = asRecord(
    await api.post('/admin/cms/exercise-imports/preview', previewBody),
    'preview',
  );
  const errors = asArray(preview.errors, 'preview.errors').map((entry) => {
    const record = asRecord(entry, 'preview.errors[]');
    return {
      rowNumber: asNumber(record.rowNumber, 'preview.errors[].rowNumber'),
      code: asString(record.code, 'preview.errors[].code'),
      path: asString(record.path, 'preview.errors[].path'),
    };
  });
  const invalidRows = asNumber(preview.invalidRows, 'preview.invalidRows');
  const previewHash = asString(preview.previewHash, 'preview.previewHash');
  if (invalidRows > 0) {
    // Chỉ bỏ qua điểm dừng khi **mọi** dòng lỗi đều là source_key_already_exists;
    // mảng rỗng không được coi là "mọi lỗi" (TL-216/§3.1 bước 3).
    const onlySourceKeys =
      errors.length > 0 &&
      errors.length === invalidRows &&
      errors.every((error) => error.code === SOURCE_KEY_ALREADY_EXISTS);
    if (!onlySourceKeys) {
      throw new PilotImportError(
        'exercise_preview_invalid',
        `Preview có ${String(invalidRows)} dòng lỗi không phải ${SOURCE_KEY_ALREADY_EXISTS}; dừng`,
        errors,
      );
    }
    // §3.3 (TL-216): mọi lỗi đều là source_key_already_exists ⇒ commit lại đúng
    // payload + đúng previewHash cũ để nhận idempotent:true.
    log(
      `preview: ${String(errors.length)} lỗi source_key_already_exists — tiếp tục replay theo §3.3`,
    );
  }
  const key = idempotencyKey(lessonSourceKey, dataSourceId, fileName, rows);
  const commitBody = { ...previewBody, previewHash };
  const maxAttempts = 3;
  let commitPayload: unknown = null;
  for (let attempt = 1; commitPayload === null; attempt += 1) {
    try {
      commitPayload = await api.post(
        '/admin/cms/exercise-imports',
        commitBody,
        {
          'idempotency-key': key,
        },
      );
    } catch (error) {
      // §3.3: timeout/503 hạ tầng thì retry tối đa 2 lần với **cùng** key.
      const retryable =
        (error instanceof PilotImportError &&
          (error.httpStatus === 503 || error.code === 'HTTP_503')) ||
        error instanceof TypeError;
      if (!retryable || attempt >= maxAttempts) throw error;
      log(
        `commit lỗi tạm thời (lần ${String(attempt)}/${String(maxAttempts)}); retry cùng Idempotency-Key`,
      );
    }
  }
  const commit = asRecord(commitPayload, 'commit');
  const importJob = asRecord(commit.importJob, 'commit.importJob');
  return {
    importJobId: asNumber(importJob.id, 'commit.importJob.id'),
    importedRows: asNumber(commit.importedRows, 'commit.importedRows'),
    idempotent: asBoolean(commit.idempotent, 'commit.idempotent'),
    previewErrors: errors,
    previewHash,
  };
}

interface LockedLessonRow {
  readonly id: number;
  readonly status: string;
  readonly publishedAt: Date | null;
  readonly deletedAt: Date | null;
}

async function writeLessonWords(
  prisma: PrismaClient,
  lessonId: number,
  words: readonly LessonFileWord[],
  fileHash: string,
  log: (line: string) => void,
): Promise<number> {
  const resolved = await resolveWordIds(prisma, words);
  await prisma.$transaction(async (tx) => {
    // Q179: khoá hàng lesson trước khi ghi.
    const locked = await tx.$queryRaw<LockedLessonRow[]>`
      SELECT "id", "status", "publishedAt", "deletedAt"
      FROM "Lesson"
      WHERE "id" = ${lessonId}
      FOR UPDATE
    `;
    const lesson = locked[0];
    if (locked.length !== 1 || lesson === undefined) {
      throw new PilotImportError(
        'lesson_not_found',
        `Lesson id=${String(lessonId)} không tồn tại khi ghi LessonWord`,
      );
    }
    if (
      lesson.status !== 'draft' ||
      lesson.publishedAt !== null ||
      lesson.deletedAt !== null
    ) {
      throw new PilotImportError(
        'lesson_not_draft',
        `Lesson id=${String(lessonId)} không còn draft (status=${lesson.status}, publishedAt=${String(
          lesson.publishedAt,
        )}, deletedAt=${String(lesson.deletedAt)}); không ghi LessonWord`,
      );
    }
    for (const [index, word] of resolved.entries()) {
      await tx.lessonWord.upsert({
        where: {
          lessonId_wordId: { lessonId, wordId: word.wordId },
        },
        create: {
          lessonId,
          wordId: word.wordId,
          orderIndex: index + 1,
        },
        update: { orderIndex: index + 1 },
      });
    }
    await tx.auditLog.create({
      data: {
        action: 'lesson_word.import_pilot',
        targetType: 'lesson',
        targetId: String(lessonId),
        correlationId: fileHash,
        afterSummary: {
          wordCount: resolved.length,
          fileHash,
        },
      },
    });
  });
  log(`lessonWord: upsert ${String(resolved.length)} từ`);
  return resolved.length;
}

async function resolveWordIds(
  prisma: PrismaClient,
  words: readonly LessonFileWord[],
): Promise<{ wordId: number; hanzi: string }[]> {
  const rows = await prisma.word.findMany({
    where: { hanzi: { in: words.map((word) => word.hanzi) } },
    select: { id: true, hanzi: true, pinyin: true },
  });
  const byHanzi = new Map<string, { id: number; pinyin: string }[]>();
  for (const row of rows) {
    const bucket = byHanzi.get(row.hanzi) ?? [];
    bucket.push({ id: row.id, pinyin: row.pinyin });
    byHanzi.set(row.hanzi, bucket);
  }
  const resolved: { wordId: number; hanzi: string }[] = [];
  for (const word of words) {
    const candidates = byHanzi.get(word.hanzi) ?? [];
    const expected = normalizePinyinForCompare(stripToneMarks(word.pinyin));
    const match = candidates.find(
      (candidate) => normalizePinyinForCompare(candidate.pinyin) === expected,
    );
    if (match === undefined) {
      throw new PilotImportError(
        'word_not_found',
        `Không resolve được Word (hanzi, pinyin) = (${word.hanzi}, ${word.pinyin}); không tự tạo Word (TL-218/TL-219)`,
      );
    }
    resolved.push({ wordId: match.id, hanzi: word.hanzi });
  }
  return resolved;
}

async function verifyImportedLesson(
  api: ApiClient,
  lessonId: number,
  expected: {
    readonly topicCount: number;
    readonly exerciseCount: number;
    readonly sourceKeys: readonly string[];
  },
): Promise<void> {
  const detail = asRecord(
    await api.get(`/admin/cms/lessons/${String(lessonId)}`),
    'verify lesson',
  );
  const lesson = asRecord(detail.lesson, 'verify lesson.lesson');
  if (lesson.status !== 'draft') {
    throw new PilotImportError(
      'verify_failed',
      `Sau khi nạp, lesson status=${String(lesson.status)} (yêu cầu draft)`,
    );
  }
  const topics = asArray(detail.topics, 'verify lesson.topics');
  if (topics.length !== expected.topicCount) {
    throw new PilotImportError(
      'verify_failed',
      `Sau khi nạp, lesson có ${String(topics.length)} topic (yêu cầu ${String(
        expected.topicCount,
      )})`,
    );
  }
  const exercises = asArray(
    await api.get(
      `/admin/cms/exercises?lessonId=${String(lessonId)}&limit=100&page=1`,
    ),
    'verify exercises',
  );
  if (exercises.length !== expected.exerciseCount) {
    throw new PilotImportError(
      'verify_failed',
      `Sau khi nạp, lesson có ${String(exercises.length)} exercise (yêu cầu ${String(
        expected.exerciseCount,
      )})`,
    );
  }
  const seen = new Set<string>();
  for (const entry of exercises) {
    const record = asRecord(entry, 'verify exercises[]');
    if (record.status !== 'draft') {
      throw new PilotImportError(
        'verify_failed',
        `Exercise ${String(record.sourceKey)} status=${String(record.status)} (yêu cầu draft)`,
      );
    }
    if (typeof record.sourceKey === 'string') seen.add(record.sourceKey);
  }
  const missing = expected.sourceKeys.filter((key) => !seen.has(key));
  if (missing.length > 0) {
    throw new PilotImportError(
      'verify_failed',
      `Thiếu exercise sourceKey sau khi nạp: ${missing.join(', ')}`,
    );
  }
}

/**
 * Chạy toàn bộ pipeline cho **một** file. Ném `PilotImportError` khi fail-fast.
 */
export async function importPilotLesson(
  dependencies: PilotImportDependencies,
  options: PilotImportOptions,
): Promise<PilotImportResult> {
  const log = dependencies.logger ?? (() => undefined);
  const fileName = basename(options.filePath);
  const rawText = readFileSync(options.filePath, 'utf8');
  const raw: unknown = JSON.parse(rawText) as unknown;

  // 0. Validate bằng đúng validator của test TL-223.
  const refs: PilotReferenceData = loadPilotReferenceData(options.backendRoot);
  const issues = validatePilotLesson(raw, fileName, refs);
  if (issues.length > 0) throwPilotContentIssues(issues, fileName);
  const file = assertLessonFile(raw);
  const steps: string[] = ['validated'];

  const api = new ApiClient(dependencies, log);
  // 0b. Preflight (chỉ đọc).
  const levelId = await findLevelId(api, file.lesson.levelCode);
  const dataSourceId = await findDataSourceId(
    api,
    file.dataSource.code,
    file.dataSource.version,
  );
  steps.push('preflight');

  const existingLesson = await findLessonId(api, file.lesson.slug);
  if (existingLesson !== null && existingLesson.status !== 'draft') {
    throw new PilotImportError(
      'lesson_not_draft',
      `Lesson slug ${file.lesson.slug} đã tồn tại với status=${existingLesson.status}; dừng, không ghi gì`,
    );
  }

  const rowsForPreview =
    existingLesson === null
      ? null
      : buildImportRows(
          file.exercises,
          existingLesson.id,
          // Dry-run trước khi có topicId chỉ preview được theo lesson; dùng lại
          // topic ids hiện có nếu lesson đã tồn tại.
          await existingTopicIds(api, existingLesson.id, file.topics),
        );
  const preview =
    rowsForPreview === null
      ? null
      : await previewOnly(api, dataSourceId, fileName, rowsForPreview, log);

  if (options.dryRun) {
    steps.push('dry-run');
    if (preview !== null) {
      steps.push('preview');
      if (preview.invalidRows > 0) {
        const blocking = preview.errors.filter(
          (error) => error.code !== SOURCE_KEY_ALREADY_EXISTS,
        );
        if (blocking.length > 0) {
          throw new PilotImportError(
            'exercise_preview_invalid',
            `Preview (dry-run) có ${String(blocking.length)} lỗi không phải ${SOURCE_KEY_ALREADY_EXISTS}`,
            blocking,
          );
        }
      }
    }
    log('dry-run: không ghi DB, không gọi endpoint ghi');
    return {
      dryRun: true,
      lessonId: existingLesson?.id ?? null,
      topicIds: {},
      importJobId: null,
      importedRows: 0,
      idempotent: false,
      previewErrors: preview?.errors ?? [],
      createdLesson: false,
      createdTopics: 0,
      lessonWordCount: 0,
      steps,
    };
  }

  // 1. Lesson draft.
  const ensuredLesson = await ensureDraftLesson(api, file.lesson, levelId, log);
  steps.push('lesson');

  // 2. Topic draft (TL-217).
  const ensuredTopics = await ensureDraftTopics(
    api,
    ensuredLesson.lessonId,
    file.topics,
    log,
  );
  steps.push('topics');

  // 3–4. Preview + commit exercise (TL-216).
  const rows = buildImportRows(
    file.exercises,
    ensuredLesson.lessonId,
    ensuredTopics.topicIds,
  );
  const imported = await importExercises(
    api,
    file.lesson.sourceKey,
    dataSourceId,
    fileName,
    rows,
    log,
  );
  steps.push('exercises');

  // 5. LessonWord (Q179).
  const fileHash = createHash('sha256').update(rawText).digest('hex');
  const lessonWordCount = await writeLessonWords(
    dependencies.prisma,
    ensuredLesson.lessonId,
    file.words,
    fileHash,
    log,
  );
  steps.push('lesson_words');

  // 6. Kiểm chứng.
  await verifyImportedLesson(api, ensuredLesson.lessonId, {
    topicCount: file.topics.length,
    exerciseCount: file.exercises.length,
    sourceKeys: file.exercises.map((exercise) => exercise.sourceKey),
  });
  steps.push('verified');

  return {
    dryRun: false,
    lessonId: ensuredLesson.lessonId,
    topicIds: ensuredTopics.topicIds,
    importJobId: imported.importJobId,
    importedRows: imported.importedRows,
    idempotent: imported.idempotent,
    previewErrors: imported.previewErrors,
    createdLesson: ensuredLesson.created,
    createdTopics: ensuredTopics.created,
    lessonWordCount,
    steps,
  };
}

async function existingTopicIds(
  api: ApiClient,
  lessonId: number,
  topics: readonly LessonFileTopic[],
): Promise<Record<string, number>> {
  const detail = asRecord(
    await api.get(`/admin/cms/lessons/${String(lessonId)}`),
    'lesson detail',
  );
  const entries = asArray(detail.topics, 'lesson detail.topics')
    .map((entry) => asRecord(entry, 'lesson detail.topics[]'))
    .map((entry) => ({
      id: asNumber(entry.id, 'topics[].id'),
      orderIndex: asNumber(entry.orderIndex, 'topics[].orderIndex'),
      title: asString(entry.title, 'topics[].title'),
    }));
  const byOrder = new Map<number, { id: number; title: string }>();
  for (const entry of entries) {
    byOrder.set(entry.orderIndex, { id: entry.id, title: entry.title });
  }
  const ids: Record<string, number> = {};
  for (const topic of topics) {
    const existing = byOrder.get(topic.orderIndex);
    // TL-217: chỉ dùng lại khi khớp title; khác title thì dry-run sẽ báo thiếu
    // thay vì preview nhầm topic của bài khác.
    if (existing !== undefined && existing.title === topic.title) {
      ids[topic.key] = existing.id;
    }
  }
  return ids;
}

async function previewOnly(
  api: ApiClient,
  dataSourceId: number,
  fileName: string,
  rows: readonly Record<string, unknown>[],
  log: (line: string) => void,
): Promise<ImportPreviewResponse> {
  const data = asRecord(
    await api.post('/admin/cms/exercise-imports/preview', {
      dataSourceId,
      fileName,
      rows,
    }),
    'preview',
  );
  log('dry-run: đã gọi preview (chỉ đọc)');
  return {
    totalRows: asNumber(data.totalRows, 'preview.totalRows'),
    validRows: asNumber(data.validRows, 'preview.validRows'),
    invalidRows: asNumber(data.invalidRows, 'preview.invalidRows'),
    errors: asArray(data.errors, 'preview.errors').map((entry) => {
      const record = asRecord(entry, 'preview.errors[]');
      return {
        rowNumber: asNumber(record.rowNumber, 'preview.errors[].rowNumber'),
        code: asString(record.code, 'preview.errors[].code'),
        path: asString(record.path, 'preview.errors[].path'),
      };
    }),
    previewHash: asString(data.previewHash, 'preview.previewHash'),
  };
}
