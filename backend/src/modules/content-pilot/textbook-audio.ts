import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';

import type { PrismaClient } from '@prisma/client';

import { canonicalJson } from '../../common/utils/canonical-json';
import { normalizePinyin } from '../../common/utils/normalize-pinyin';
import {
  Api,
  ExamImportError,
  isRecord,
  sha256,
  type ExamImportDeps,
} from '../content-hsk1/import-exam';
import { textbookSeeddataPaths } from './import-textbook-grade';
import {
  convertTextbookSeeddataEach,
  TEXTBOOK_DATA_SOURCE,
  type TextbookKeyText,
} from './textbook-seeddata.converter';

/**
 * M2.13c (TL 24/11/2026, hướng A): audio từ vựng của giáo trình HSK 2.0.
 * File mp3 của seeddata đi qua `POST /admin/cms/media/ingestions` (provenance
 * `HSK20_TEXTBOOK_PO_V1`, idempotent theo sha256 + ledger), rồi gắn vào
 * `Word.audioId` chỉ khi Word chưa có audio: một transaction + `FOR UPDATE`
 * + AuditLog `word.audio_attached` cho mỗi Word. Không in nội dung seeddata.
 */
export const AUDIO_MAX_BYTES = 2 * 1024 * 1024;
export const AUDIO_ATTACHED_AUDIT_ACTION = 'word.audio_attached';

export type AudioFileIssue =
  | 'audio_path_outside_root'
  | 'audio_missing'
  | 'audio_not_mp3'
  | 'audio_empty'
  | 'audio_too_large'
  | 'audio_unreadable';

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    rel !== '' &&
    !rel.startsWith(`..${sep}`) &&
    rel !== '..' &&
    !isAbsolute(rel)
  );
}

/**
 * `ref` is relative to `baseDir`; the real path (symlinks followed) must stay
 * inside the real `seeddataRoot`.
 */
export function resolveAudioPath(
  seeddataRoot: string,
  baseDir: string,
  ref: string,
): { ok: true; path: string } | { ok: false; code: AudioFileIssue } {
  if (isAbsolute(ref)) return { ok: false, code: 'audio_path_outside_root' };
  const root = realpathSync(seeddataRoot);
  const candidate = resolve(baseDir, ref);
  if (!isInside(root, candidate) && !isInside(seeddataRoot, candidate)) {
    return { ok: false, code: 'audio_path_outside_root' };
  }
  if (extname(candidate).toLowerCase() !== '.mp3') {
    return { ok: false, code: 'audio_not_mp3' };
  }
  if (!existsSync(candidate)) return { ok: false, code: 'audio_missing' };
  const real = realpathSync(candidate);
  const stat = statSync(real);
  if (!isInside(root, real) || !stat.isFile()) {
    return { ok: false, code: 'audio_path_outside_root' };
  }
  // Before reading: never buffer an oversized file.
  if (stat.size > AUDIO_MAX_BYTES)
    return { ok: false, code: 'audio_too_large' };
  return { ok: true, path: real };
}

/** Same signatures as the ingestion processor (ID3 tag or MPEG frame sync). */
export function checkAudioBytes(bytes: Buffer): AudioFileIssue | null {
  if (bytes.length === 0) return 'audio_empty';
  if (bytes.length > AUDIO_MAX_BYTES) return 'audio_too_large';
  const id3 =
    bytes.length >= 3 && bytes.subarray(0, 3).toString('ascii') === 'ID3';
  const sync =
    bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  return id3 || sync ? null : 'audio_not_mp3';
}

export function shouldAttachAudio(word: {
  readonly audioId: number | null;
  readonly deletedAt: Date | null;
}): boolean {
  return word.audioId === null && word.deletedAt === null;
}

export interface TextbookAudioLesson {
  readonly fileName: string;
  readonly slug: string;
  readonly words: ReadonlyArray<{
    readonly hanzi: string;
    readonly pinyin: string;
    readonly audioRef: string;
  }>;
  /** M2.13d: key texts; their `audioRef` is relative to `keyTextBaseDir`. */
  readonly keyTexts: readonly TextbookKeyText[];
}

/**
 * The grade's lessons from seeddata (same converter as the grade import) and
 * the directory their `audioRef`s are relative to. Lessons the converter
 * rejects are returned by number only, never with content.
 */
export function readTextbookAudioLessons(
  seeddataRoot: string,
  grade: number,
): {
  lessons: TextbookAudioLesson[];
  audioBaseDir: string;
  keyTextBaseDir: string;
  skippedLessons: number[];
} {
  const paths = textbookSeeddataPaths(seeddataRoot, grade);
  const read = (path: string, what: string): unknown => {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch {
      throw new ExamImportError(
        'seeddata_unreadable',
        `Không đọc được ${what}`,
      );
    }
  };
  const { files, failures } = convertTextbookSeeddataEach({
    vocab: read(paths.vocab, 'từ vựng'),
    lessons: read(paths.lessons, 'bài học'),
    grade,
    from: 1,
  });
  return {
    lessons: files.map(({ fileName, content }) => ({
      fileName,
      slug: content.lesson.slug,
      words: content.words.map(({ hanzi, pinyin, audioRef }) => ({
        hanzi,
        pinyin,
        audioRef,
      })),
      keyTexts: content.keyTexts,
    })),
    audioBaseDir: dirname(paths.vocab),
    keyTextBaseDir: dirname(paths.lessons),
    skippedLessons: failures.map((failure) => failure.bai),
  };
}

export interface TextbookAudioOptions {
  readonly lessons: readonly TextbookAudioLesson[];
  readonly seeddataRoot: string;
  /** Directory the `audioRef`s are relative to. */
  readonly audioBaseDir: string;
  readonly ledgerPath: string;
  readonly dryRun: boolean;
  readonly actorId: number | null;
}

export interface TextbookAudioLessonSummary {
  readonly fileName: string;
  readonly words: number;
  /** Distinct readable mp3 files of the lesson. */
  readonly files: number;
  readonly bytes: number;
  readonly missing: number;
  readonly invalid: number;
  /** Lesson not imported yet, or the word is not linked to it. */
  readonly wordNotFound: number;
  /** Dry-run only: Words a real run would attach audio to. */
  readonly pending: number;
  readonly ingested: number;
  readonly attached: number;
  readonly skippedHasAudio: number;
  readonly errors: number;
}

export interface TextbookAudioSummary {
  readonly dryRun: boolean;
  readonly lessons: readonly TextbookAudioLessonSummary[];
  readonly totals: Omit<TextbookAudioLessonSummary, 'fileName'>;
  /** Error codes only, never content. */
  readonly errorCodes: Readonly<Record<string, number>>;
}

interface Ledger {
  /** Media ids belong to one environment: a ledger is refused elsewhere. */
  apiBaseUrl: string;
  media: Record<string, number>;
}

function readLedger(path: string, apiBaseUrl: string): Ledger {
  if (!existsSync(path)) return { apiBaseUrl, media: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new ExamImportError('ledger_invalid', 'Sổ audio không parse được');
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.apiBaseUrl !== 'string' ||
    !isRecord(parsed.media) ||
    !Object.values(parsed.media).every((id) => Number.isSafeInteger(id))
  ) {
    throw new ExamImportError('ledger_invalid', 'Sổ audio sai định dạng');
  }
  if (parsed.apiBaseUrl !== apiBaseUrl) {
    throw new ExamImportError(
      'ledger_environment_mismatch',
      'Sổ audio thuộc môi trường khác; dùng --ledger khác',
    );
  }
  return { apiBaseUrl, media: parsed.media as Record<string, number> };
}

async function textbookMediaSourceId(api: Api): Promise<number> {
  const rows = await api.request(
    'GET',
    '/admin/cms/data-sources?eligibleFor=media&page=1&limit=100',
  );
  const list: unknown[] = Array.isArray(rows) ? rows : [];
  const source = list.find(
    (row) => isRecord(row) && row.code === TEXTBOOK_DATA_SOURCE.code,
  );
  if (!isRecord(source) || typeof source.id !== 'number') {
    throw new ExamImportError(
      'data_source_missing',
      `Nguồn ${TEXTBOOK_DATA_SOURCE.code} chưa đủ điều kiện media`,
    );
  }
  return source.id;
}

/**
 * Media id of `bytes`: from the ledger, else one ingestion (idempotent by
 * sha256 on the server) recorded in the ledger at once.
 */
async function ingestAudio(
  api: Api,
  sourceId: number,
  ledger: Ledger,
  ledgerPath: string,
  bytes: Buffer,
  digest: string,
): Promise<{ mediaId: number; uploaded: boolean }> {
  const known = ledger.media[digest];
  if (known !== undefined) return { mediaId: known, uploaded: false };
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' }),
    `${digest.slice(0, 32)}.mp3`,
  );
  const data = await api.request(
    'POST',
    `/admin/cms/media/ingestions?dataSourceId=${String(sourceId)}`,
    form,
    { 'idempotency-key': `hsk20-textbook-audio-${digest.slice(0, 48)}` },
  );
  const media = isRecord(data) && isRecord(data.media) ? data.media : null;
  if (media === null || typeof media.id !== 'number') {
    throw new ExamImportError(
      'invalid_api_response',
      'ingestion thiếu media.id',
    );
  }
  ledger.media[digest] = media.id;
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  return { mediaId: media.id, uploaded: true };
}

/** One transaction per Word: lock, re-check, attach, audit. */
async function attach(
  prisma: PrismaClient,
  wordId: number,
  mediaId: number,
  actorId: number,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<
      Array<{ audioId: number | null; deletedAt: Date | null }>
    >`SELECT "audioId", "deletedAt" FROM "Word" WHERE "id" = ${wordId} FOR UPDATE`;
    const row = locked[0];
    if (row === undefined || !shouldAttachAudio(row)) return false;
    await tx.word.update({
      where: { id: wordId },
      data: { audioId: mediaId, updatedById: actorId },
      select: { id: true },
    });
    // Ids and codes only: no hanzi, meaning or file name.
    await tx.auditLog.create({
      data: {
        actorId,
        action: AUDIO_ATTACHED_AUDIT_ACTION,
        targetType: 'word',
        targetId: String(wordId),
        beforeSummary: { audioId: null },
        afterSummary: {
          wordId,
          audioId: mediaId,
          dataSource: TEXTBOOK_DATA_SOURCE.code,
        },
      },
      select: { id: true },
    });
    return true;
  });
}

export async function importTextbookAudio(
  deps: ExamImportDeps & { readonly prisma: PrismaClient },
  options: TextbookAudioOptions,
): Promise<TextbookAudioSummary> {
  const log = deps.log ?? (() => undefined);
  const api = new Api(deps);
  // A dry-run never reads or writes the ledger.
  const ledger = options.dryRun
    ? { apiBaseUrl: deps.apiBaseUrl, media: {} }
    : readLedger(options.ledgerPath, deps.apiBaseUrl);
  const errorCodes: Record<string, number> = {};
  const fail = (code: string) => {
    errorCodes[code] = (errorCodes[code] ?? 0) + 1;
  };
  if (!options.dryRun && options.actorId === null) {
    throw new ExamImportError('actor_missing', 'Cần actorId khi không dry-run');
  }
  const sourceId = options.dryRun ? null : await textbookMediaSourceId(api);
  let uploads = 0;
  const lessons: TextbookAudioLessonSummary[] = [];

  for (const lesson of options.lessons) {
    const counts = {
      words: lesson.words.length,
      files: 0,
      bytes: 0,
      missing: 0,
      invalid: 0,
      wordNotFound: 0,
      pending: 0,
      ingested: 0,
      attached: 0,
      skippedHasAudio: 0,
      errors: 0,
    };
    const linked = await deps.prisma.lessonWord.findMany({
      where: { lesson: { slug: lesson.slug, deletedAt: null } },
      select: {
        word: {
          select: {
            id: true,
            hanzi: true,
            pinyin: true,
            audioId: true,
            deletedAt: true,
          },
        },
      },
    });
    // The importer resolves lesson words by hanzi; pinyin only splits ties.
    const findWord = (hanzi: string, pinyin: string) => {
      const same = linked.filter(({ word }) => word.hanzi === hanzi);
      const pick =
        same.length === 1
          ? same
          : same.filter(
              ({ word }) =>
                normalizePinyin(word.pinyin) === normalizePinyin(pinyin),
            );
      return pick.length === 1 ? pick[0].word : undefined;
    };
    const seenFiles = new Set<string>();
    for (const item of lesson.words) {
      const resolved = resolveAudioPath(
        options.seeddataRoot,
        options.audioBaseDir,
        item.audioRef,
      );
      if (!resolved.ok) {
        if (resolved.code === 'audio_missing') counts.missing += 1;
        else counts.invalid += 1;
        fail(resolved.code);
        continue;
      }
      let bytes: Buffer;
      try {
        bytes = readFileSync(resolved.path);
      } catch {
        counts.invalid += 1;
        fail('audio_unreadable');
        continue;
      }
      const issue = checkAudioBytes(bytes);
      if (issue !== null) {
        counts.invalid += 1;
        fail(issue);
        continue;
      }
      const digest = sha256(bytes);
      if (!seenFiles.has(digest)) {
        seenFiles.add(digest);
        counts.files += 1;
        counts.bytes += bytes.length;
      }
      const word = findWord(item.hanzi, item.pinyin);
      if (word === undefined) {
        counts.wordNotFound += 1;
        continue;
      }
      if (!shouldAttachAudio(word)) {
        counts.skippedHasAudio += 1;
        continue;
      }
      if (options.dryRun) {
        counts.pending += 1;
        continue;
      }
      try {
        const { mediaId, uploaded } = await ingestAudio(
          api,
          sourceId as number,
          ledger,
          options.ledgerPath,
          bytes,
          digest,
        );
        if (uploaded) {
          counts.ingested += 1;
          uploads += 1;
          if (uploads % 10 === 0) log(`đã nạp ${String(uploads)} file audio`);
        }
        if (
          await attach(deps.prisma, word.id, mediaId, options.actorId as number)
        ) {
          counts.attached += 1;
        } else {
          counts.skippedHasAudio += 1;
        }
      } catch (error) {
        counts.errors += 1;
        fail(error instanceof ExamImportError ? error.code : 'unknown');
      }
    }
    lessons.push({ fileName: lesson.fileName, ...counts });
  }

  const totals = lessons.reduce(
    (sum, row) => {
      const next = { ...sum };
      for (const key of Object.keys(sum) as Array<keyof typeof sum>) {
        next[key] = sum[key] + row[key];
      }
      return next;
    },
    {
      words: 0,
      files: 0,
      bytes: 0,
      missing: 0,
      invalid: 0,
      wordNotFound: 0,
      pending: 0,
      ingested: 0,
      attached: 0,
      skippedHasAudio: 0,
      errors: 0,
    },
  );
  return { dryRun: options.dryRun, lessons, totals, errorCodes };
}

/**
 * Index of the one `dialogue` block whose line hanzi are exactly `hanzi`
 * (same order), else -1: no match, or several (never guess).
 */
export function findDialogueBlock(
  content: unknown,
  hanzi: readonly string[],
): number {
  if (!Array.isArray(content)) return -1;
  const matches = (content as unknown[]).flatMap((block, index) => {
    if (!isRecord(block) || block.type !== 'dialogue') return [];
    const lines = Array.isArray(block.lines) ? (block.lines as unknown[]) : [];
    const same =
      lines.length === hanzi.length &&
      lines.every((line, i) => isRecord(line) && line.hanzi === hanzi[i]);
    return same ? [index] : [];
  });
  return matches.length === 1 ? matches[0] : -1;
}

export interface TextbookKeyTextAudioOptions {
  readonly lessons: readonly TextbookAudioLesson[];
  readonly seeddataRoot: string;
  /** Directory the key texts' `audioRef`s are relative to. */
  readonly keyTextBaseDir: string;
  readonly ledgerPath: string;
  readonly dryRun: boolean;
}

export interface TextbookKeyTextLessonSummary {
  readonly fileName: string;
  readonly texts: number;
  readonly files: number;
  readonly bytes: number;
  readonly missing: number;
  readonly invalid: number;
  /** Per-line refs: seeddata has no such files (M2.13d), counted only. */
  readonly lineAudioUnavailable: number;
  /** Paragraph texts: only `dialogue` blocks carry audio. */
  readonly unsupportedText: number;
  /** Lesson, key_text topic or one exactly matching dialogue not found. */
  readonly blockNotFound: number;
  readonly pending: number;
  readonly ingested: number;
  readonly attached: number;
  readonly skippedHasAudio: number;
  /** CMS revisions created (one per changed topic). */
  readonly topicsRevised: number;
  /** Topics edited between the first read and the write (`topic_changed`). */
  readonly topicChanged: number;
  readonly errors: number;
}

export interface TextbookKeyTextAudioSummary {
  readonly dryRun: boolean;
  readonly lessons: readonly TextbookKeyTextLessonSummary[];
  readonly totals: Omit<TextbookKeyTextLessonSummary, 'fileName'>;
  readonly errorCodes: Readonly<Record<string, number>>;
}

const TOPIC_SNAPSHOT_SELECT = {
  id: true,
  status: true,
  title: true,
  subtitle: true,
  type: true,
  content: true,
  orderIndex: true,
  isPremium: true,
  isLocked: true,
  updatedAt: true,
} as const;

function snapshotOf(topic: {
  title: string;
  subtitle: string | null;
  type: string;
  content: unknown;
  orderIndex: number;
  isPremium: boolean;
  isLocked: boolean;
}) {
  return {
    title: topic.title,
    subtitle: topic.subtitle,
    type: topic.type,
    content: topic.content,
    orderIndex: topic.orderIndex,
    isPremium: topic.isPremium,
    isLocked: topic.isLocked,
  };
}

/**
 * M2.13d: audio cả bài khoá. Mỗi file mp3 đi qua media ingestion như audio từ
 * vựng; block `dialogue` khớp hanzi nhận `audioMediaId` qua CMS: một revision
 * cho mỗi topic đổi (`POST /admin/cms/topics/:id/revisions`), topic published
 * thì review `approved` rồi publish. Topic published đang có bản sửa chưa
 * publish thì bỏ qua (`topic_pending_revision`) để không publish nhầm bản đó.
 * Không ghi `Topic.content` bằng Prisma; không in nội dung seeddata.
 */
export async function importTextbookKeyTextAudio(
  deps: ExamImportDeps & { readonly prisma: PrismaClient },
  options: TextbookKeyTextAudioOptions,
): Promise<TextbookKeyTextAudioSummary> {
  const api = new Api(deps);
  const ledger = options.dryRun
    ? { apiBaseUrl: deps.apiBaseUrl, media: {} }
    : readLedger(options.ledgerPath, deps.apiBaseUrl);
  const errorCodes: Record<string, number> = {};
  const fail = (code: string) => {
    errorCodes[code] = (errorCodes[code] ?? 0) + 1;
  };
  const sourceId = options.dryRun ? null : await textbookMediaSourceId(api);
  const lessons: TextbookKeyTextLessonSummary[] = [];

  for (const lesson of options.lessons) {
    const counts = {
      texts: lesson.keyTexts.length,
      files: 0,
      bytes: 0,
      missing: 0,
      invalid: 0,
      lineAudioUnavailable: 0,
      unsupportedText: 0,
      blockNotFound: 0,
      pending: 0,
      ingested: 0,
      attached: 0,
      skippedHasAudio: 0,
      topicsRevised: 0,
      topicChanged: 0,
      errors: 0,
    };
    const topics = await deps.prisma.topic.findMany({
      where: {
        type: 'key_text',
        deletedAt: null,
        status: { not: 'archived' },
        lesson: { slug: lesson.slug, deletedAt: null },
      },
      orderBy: { orderIndex: 'asc' },
      select: TOPIC_SNAPSHOT_SELECT,
    });
    // Working copies: blocks get `audioMediaId` here, one revision per topic.
    // `latest` is the newest revision seen now: re-checked before writing.
    const latestById = new Map<number, LatestRevision | null>();
    for (const topic of topics) {
      latestById.set(topic.id, await latestRevision(deps.prisma, topic.id));
    }
    const working = topics.map((topic) => ({
      latest: latestById.get(topic.id) ?? null,
      topic,
      content: Array.isArray(topic.content)
        ? (topic.content as unknown[]).map((block) =>
            isRecord(block) ? { ...block } : block,
          )
        : topic.content,
      attached: 0,
    }));
    const seenFiles = new Set<string>();
    for (const text of lesson.keyTexts) {
      counts.lineAudioUnavailable += text.lineAudioRefs;
      if (!text.dialogue) {
        counts.unsupportedText += 1;
        continue;
      }
      const resolved = resolveAudioPath(
        options.seeddataRoot,
        options.keyTextBaseDir,
        text.audioRef,
      );
      if (!resolved.ok) {
        if (resolved.code === 'audio_missing') counts.missing += 1;
        else counts.invalid += 1;
        fail(resolved.code);
        continue;
      }
      let bytes: Buffer;
      try {
        bytes = readFileSync(resolved.path);
      } catch {
        counts.invalid += 1;
        fail('audio_unreadable');
        continue;
      }
      const issue = checkAudioBytes(bytes);
      if (issue !== null) {
        counts.invalid += 1;
        fail(issue);
        continue;
      }
      const digest = sha256(bytes);
      if (!seenFiles.has(digest)) {
        seenFiles.add(digest);
        counts.files += 1;
        counts.bytes += bytes.length;
      }
      const hits = working.flatMap((entry) => {
        const index = findDialogueBlock(entry.content, text.hanzi);
        return index === -1 ? [] : [{ entry, index }];
      });
      if (hits.length !== 1) {
        counts.blockNotFound += 1;
        continue;
      }
      const { entry, index } = hits[0];
      const block = (entry.content as Array<Record<string, unknown>>)[index];
      if (block.audioMediaId !== undefined) {
        counts.skippedHasAudio += 1;
        continue;
      }
      if (options.dryRun) {
        counts.pending += 1;
        continue;
      }
      try {
        const { mediaId, uploaded } = await ingestAudio(
          api,
          sourceId as number,
          ledger,
          options.ledgerPath,
          bytes,
          digest,
        );
        if (uploaded) counts.ingested += 1;
        block.audioMediaId = mediaId;
        entry.attached += 1;
        counts.attached += 1;
      } catch (error) {
        counts.errors += 1;
        fail(error instanceof ExamImportError ? error.code : 'unknown');
      }
    }

    for (const entry of working) {
      if (entry.attached === 0) continue;
      try {
        await reviseTopic(
          deps.prisma,
          api,
          entry.topic,
          entry.latest,
          entry.content,
        );
        counts.topicsRevised += 1;
      } catch (error) {
        counts.attached -= entry.attached;
        counts.errors += 1;
        const code = error instanceof ExamImportError ? error.code : 'unknown';
        if (code === 'topic_changed') counts.topicChanged += 1;
        fail(code);
      }
    }
    lessons.push({ fileName: lesson.fileName, ...counts });
  }

  const zero: Omit<TextbookKeyTextLessonSummary, 'fileName'> = {
    texts: 0,
    files: 0,
    bytes: 0,
    missing: 0,
    invalid: 0,
    lineAudioUnavailable: 0,
    unsupportedText: 0,
    blockNotFound: 0,
    pending: 0,
    ingested: 0,
    attached: 0,
    skippedHasAudio: 0,
    topicsRevised: 0,
    topicChanged: 0,
    errors: 0,
  };
  const totals = lessons.reduce((sum, row) => {
    const next = { ...sum };
    for (const key of Object.keys(sum) as Array<keyof typeof sum>) {
      next[key] = sum[key] + row[key];
    }
    return next;
  }, zero);
  return { dryRun: options.dryRun, lessons, totals, errorCodes };
}

interface LatestRevision {
  readonly id: number;
  readonly revision: number;
  readonly snapshot: unknown;
  readonly decision: string | null;
}

async function latestRevision(
  prisma: PrismaClient,
  topicId: number,
): Promise<LatestRevision | null> {
  const row = await prisma.contentRevision.findFirst({
    where: { entityType: 'topic', entityId: topicId },
    orderBy: [{ revision: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      revision: true,
      snapshot: true,
      reviews: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { decision: true },
      },
    },
  });
  return row === null
    ? null
    : {
        id: row.id,
        revision: row.revision,
        snapshot: row.snapshot,
        decision: row.reviews[0]?.decision ?? null,
      };
}

type SnapshotTopic = Parameters<typeof snapshotOf>[0] & {
  id: number;
  status: string;
  updatedAt: Date;
};

/**
 * Patched content through the CMS; a live topic is reviewed and published.
 * Right before writing, the topic and its newest revision are read again:
 * any change since the first read stops the topic (`topic_changed`), so an
 * editor's work is never overwritten by the snapshot read before the upload.
 * A pending revision equal to the intended snapshot (an earlier run that
 * failed after creating it) is reviewed and published instead of a new one.
 */
async function reviseTopic(
  prisma: PrismaClient,
  api: Api,
  topic: SnapshotTopic,
  seen: LatestRevision | null,
  content: unknown,
): Promise<void> {
  const now = await prisma.topic.findUnique({
    where: { id: topic.id },
    select: TOPIC_SNAPSHOT_SELECT,
  });
  const latest = await latestRevision(prisma, topic.id);
  if (
    now === null ||
    now.updatedAt.getTime() !== topic.updatedAt.getTime() ||
    canonicalJson(now.content) !== canonicalJson(topic.content) ||
    now.status !== topic.status ||
    (latest?.id ?? null) !== (seen?.id ?? null)
  ) {
    throw new ExamImportError(
      'topic_changed',
      'Topic đổi sau lần đọc đầu; bỏ qua',
    );
  }
  const intended = { ...snapshotOf(topic), content };
  let revisionId: number;
  let decision: string | null = null;
  if (
    topic.status === 'published' &&
    latest !== null &&
    canonicalJson(latest.snapshot) === canonicalJson(intended)
  ) {
    revisionId = latest.id;
    decision = latest.decision;
  } else {
    if (
      topic.status === 'published' &&
      (latest === null ||
        canonicalJson(latest.snapshot) !== canonicalJson(snapshotOf(topic)))
    ) {
      throw new ExamImportError(
        'topic_pending_revision',
        'Topic có bản sửa chưa publish; bỏ qua',
      );
    }
    const created = await api.request(
      'POST',
      `/admin/cms/topics/${String(topic.id)}/revisions`,
      intended,
    );
    const revision =
      isRecord(created) && isRecord(created.revision) ? created.revision : null;
    if (revision === null || typeof revision.id !== 'number') {
      throw new ExamImportError(
        'invalid_api_response',
        'revision thiếu revision.id',
      );
    }
    revisionId = revision.id;
  }
  if (topic.status !== 'published') return;
  const base = `/admin/cms/topics/${String(topic.id)}/revisions/${String(revisionId)}`;
  if (decision !== 'approved') {
    await api.request('POST', `${base}/reviews`, { decision: 'approved' });
  }
  await api.request('POST', `${base}/publish`, {});
}
