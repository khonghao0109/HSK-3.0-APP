import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { canonicalJson } from '../../common/utils/canonical-json';

/**
 * Nạp đề thi thử HSK1 (lát cắt 23/11, PO 18/11/2026) qua API CMS, không ghi DB
 * trực tiếp. Trình tự: ảnh ghép → media ingestion (alt tiếng Việt, Q350) → câu
 * hỏi `draft` → đề "Đọc" `draft` + cấu trúc. Idempotent theo P3: sổ
 * `sourceKey → id` (ledger, một file cho mỗi môi trường) và `contentHash`
 * của revision; câu đã có nhưng nội dung khác thì dừng, không tự sửa.
 * Câu Nghe nạp vào ngân hàng câu hỏi nhưng không đưa vào đề Đọc (Q351).
 */

export interface ExamOption {
  readonly id: string;
  readonly text: string;
}
export interface ExamQuestion {
  readonly sourceKey: string;
  readonly type: 'mcq';
  readonly prompt: string;
  readonly imageKey: string | null;
  readonly options: readonly ExamOption[];
  readonly answer: { readonly optionId: string };
  readonly transcript: unknown;
  readonly explanation: string;
  readonly difficulty: number;
  readonly tags: readonly string[];
}
export interface ExamPart {
  readonly key: string;
  readonly title: string;
  readonly instruction: string;
  readonly imageKey: string | null;
  readonly questions: readonly ExamQuestion[];
}
export interface ExamSection {
  readonly skill: 'listening' | 'reading';
  readonly title: string;
  readonly instruction: string;
  readonly parts: readonly ExamPart[];
}
export interface ExamImage {
  readonly key: string;
  readonly altVi: string;
}
export interface ExamFile {
  readonly test: { readonly sourceKey: string };
  readonly demoTests: readonly DemoTest[];
  readonly images: readonly ExamImage[];
  readonly sections: readonly ExamSection[];
}
export interface DemoTest {
  readonly sourceKey: string;
  readonly title: string;
  readonly instruction: string;
  readonly durationMinutes: number;
  readonly passScore: number;
  readonly sections: readonly ('listening' | 'reading')[];
}

export interface ExamLedger {
  media: Record<string, { id: number; sha256: string }>;
  questions: Record<string, { id: number; payloadSha256: string }>;
  tests: Record<string, { id: number }>;
}

export interface ExamImportDeps {
  readonly apiBaseUrl: string;
  readonly adminToken: string;
  readonly fetchImpl?: typeof fetch;
  readonly log?: (line: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
}
export interface ExamImportOptions {
  readonly file: ExamFile;
  readonly imagesDir: string;
  readonly ledgerPath: string;
  readonly dataSourceCode: string;
  readonly levelCode: string;
  readonly dryRun: boolean;
}

export class ExamImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const sha256 = (value: Buffer | string) =>
  createHash('sha256').update(value).digest('hex');

export function readLedger(path: string): ExamLedger {
  if (!existsSync(path)) return { media: {}, questions: {}, tests: {} };
  return JSON.parse(readFileSync(path, 'utf8')) as ExamLedger;
}

function writeLedger(path: string, ledger: ExamLedger) {
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
}

/** Body `POST /admin/cms/questions`; câu chọn tranh gắn ảnh riêng qua `imageId`. */
export function questionPayload(
  question: ExamQuestion,
  skill: ExamSection['skill'],
  levelId: number,
  imageId: number | null,
) {
  return {
    type: question.type,
    skill,
    levelId,
    content: question.prompt,
    answers: { options: question.options },
    correctAnswer: { optionId: question.answer.optionId },
    explanation: question.explanation,
    objective: null,
    difficulty: question.difficulty,
    audioId: null,
    imageId,
    tags: [...question.tags],
  };
}

export class Api {
  constructor(private readonly deps: ExamImportDeps) {}

  async request(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<unknown> {
    const isForm = body instanceof FormData;
    // 429 bị từ chối trước khi xử lý (ingestion còn idempotent theo key), nên chờ rồi gửi lại.
    for (let attempt = 1; ; attempt += 1) {
      const response = await this.send(method, path, body, headers, isForm);
      if (response.status !== 429 || attempt >= 20) {
        return this.parse(method, path, response);
      }
      const retryAfter = Number(response.headers.get('retry-after'));
      const seconds =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 15;
      this.deps.log?.(`${method} ${path} → 429, chờ ${seconds}s`);
      await (this.deps.sleep ?? defaultSleep)(seconds * 1000);
    }
  }

  private send(
    method: string,
    path: string,
    body: unknown,
    headers: Record<string, string>,
    isForm: boolean,
  ): Promise<Response> {
    return (this.deps.fetchImpl ?? fetch)(`${this.deps.apiBaseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.deps.adminToken}`,
        accept: 'application/json',
        ...(body === undefined || isForm
          ? {}
          : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined
        ? {}
        : { body: isForm ? (body as FormData) : JSON.stringify(body) }),
    });
  }

  private async parse(
    method: string,
    path: string,
    response: Response,
  ): Promise<unknown> {
    const text = await response.text();
    const payload: unknown = text.length > 0 ? JSON.parse(text) : null;
    if (!response.ok || !isRecord(payload) || payload.success !== true) {
      const error =
        isRecord(payload) && isRecord(payload.error) ? payload.error : {};
      throw new ExamImportError(
        typeof error.code === 'string' ? error.code : `HTTP_${response.status}`,
        `${typeof error.message === 'string' ? error.message : 'API lỗi'} (${method} ${path})`,
        response.status,
      );
    }
    this.deps.log?.(`${method} ${path} → ${response.status}`);
    return payload.data;
  }
}

async function findId(
  api: Api,
  path: string,
  field: string,
  value: string,
): Promise<number> {
  for (let page = 1; page <= 20; page += 1) {
    const data = await api.request(
      'GET',
      `${path}${path.includes('?') ? '&' : '?'}page=${page}&limit=100`,
    );
    const rows = Array.isArray(data) ? data : [];
    for (const row of rows) {
      if (isRecord(row) && row[field] === value && typeof row.id === 'number') {
        return row.id;
      }
    }
    if (rows.length < 100) break;
  }
  throw new ExamImportError(
    'not_found',
    `Không tìm thấy ${field}=${value} ở ${path}`,
  );
}

export interface ExamImportResult {
  readonly media: Record<string, number>;
  readonly questions: Record<string, number>;
  readonly tests: Record<string, number>;
  readonly created: { media: number; questions: number; tests: number };
}

export async function importExam(
  deps: ExamImportDeps,
  options: ExamImportOptions,
): Promise<ExamImportResult> {
  const api = new Api(deps);
  const log = deps.log ?? (() => undefined);
  const ledger = readLedger(options.ledgerPath);
  const created = { media: 0, questions: 0, tests: 0 };
  const save = () => {
    if (!options.dryRun) writeLedger(options.ledgerPath, ledger);
  };

  const levelData = await api.request('GET', '/levels');
  const levels: unknown[] = Array.isArray(levelData) ? levelData : [];
  const level = levels.find(
    (row) => isRecord(row) && row.code === options.levelCode,
  );
  if (!isRecord(level) || typeof level.id !== 'number') {
    throw new ExamImportError(
      'level_missing',
      `Thiếu level ${options.levelCode}`,
    );
  }
  const levelId = level.id;
  const dataSourceId = await findId(
    api,
    '/admin/cms/data-sources?eligibleFor=media',
    'code',
    options.dataSourceCode,
  );

  // 1. Ảnh ghép → media (Idempotency-Key = sha256 nội dung + alt).
  const mediaIds: Record<string, number> = {};
  for (const image of options.file.images) {
    const bytes = readFileSync(join(options.imagesDir, `${image.key}.png`));
    const digest = sha256(bytes);
    const known = ledger.media[image.key];
    if (known !== undefined && known.sha256 === digest) {
      mediaIds[image.key] = known.id;
      continue;
    }
    if (options.dryRun) {
      log(`dry-run: sẽ nạp ảnh ${image.key}`);
      continue;
    }
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
      `${image.key}.png`,
    );
    const key = `hsk1-exam-${sha256(`${digest}\n${image.altVi}`).slice(0, 48)}`;
    const data = await api.request(
      'POST',
      `/admin/cms/media/ingestions?dataSourceId=${dataSourceId}&altText=${encodeURIComponent(image.altVi)}`,
      form,
      { 'idempotency-key': key },
    );
    const media = isRecord(data) && isRecord(data.media) ? data.media : null;
    if (media === null || typeof media.id !== 'number') {
      throw new ExamImportError(
        'invalid_api_response',
        'ingestion thiếu media.id',
      );
    }
    ledger.media[image.key] = { id: media.id, sha256: digest };
    mediaIds[image.key] = media.id;
    created.media += 1;
    save();
  }

  // 2. Câu hỏi draft (cả Nghe và Đọc vào ngân hàng câu hỏi).
  const questionIds: Record<string, number> = {};
  for (const section of options.file.sections) {
    for (const part of section.parts) {
      for (const question of part.questions) {
        const imageId =
          question.imageKey === null
            ? null
            : (mediaIds[question.imageKey] ?? null);
        if (question.imageKey !== null && imageId === null && !options.dryRun) {
          throw new ExamImportError(
            'image_missing',
            `${question.sourceKey}: thiếu ảnh`,
          );
        }
        const payload = questionPayload(
          question,
          section.skill,
          levelId,
          imageId,
        );
        const payloadSha256 = sha256(canonicalJson(payload));
        const known = ledger.questions[question.sourceKey];
        if (known !== undefined) {
          if (known.payloadSha256 !== payloadSha256) {
            throw new ExamImportError(
              'question_changed',
              `${question.sourceKey} (id ${known.id}) đã nạp với nội dung khác; tạo revision qua CMS rồi cập nhật sổ`,
            );
          }
          const current = await api.request(
            'GET',
            `/admin/cms/questions/${known.id}`,
          );
          if (!isRecord(current) || current.id !== known.id) {
            throw new ExamImportError(
              'question_missing',
              `${question.sourceKey}: không đọc được id ${known.id}`,
            );
          }
          questionIds[question.sourceKey] = known.id;
          continue;
        }
        if (options.dryRun) {
          log(`dry-run: sẽ tạo câu ${question.sourceKey}`);
          continue;
        }
        const data = await api.request('POST', '/admin/cms/questions', payload);
        const record =
          isRecord(data) && isRecord(data.question) ? data.question : data;
        if (!isRecord(record) || typeof record.id !== 'number') {
          throw new ExamImportError(
            'invalid_api_response',
            'create question thiếu id',
          );
        }
        ledger.questions[question.sourceKey] = { id: record.id, payloadSha256 };
        questionIds[question.sourceKey] = record.id;
        created.questions += 1;
        save();
      }
    }
  }

  // 3. Đề demo draft + cấu trúc.
  const testIds: Record<string, number> = {};
  for (const demo of options.file.demoTests) {
    let testId = ledger.tests[demo.sourceKey]?.id;
    if (testId === undefined) {
      if (options.dryRun) {
        log(`dry-run: sẽ tạo đề ${demo.title}`);
        continue;
      }
      const data = await api.request('POST', '/admin/cms/tests', {
        levelId,
        title: demo.title,
        instruction: demo.instruction,
        duration: demo.durationMinutes,
        passScore: demo.passScore,
      });
      const record = isRecord(data) && isRecord(data.test) ? data.test : data;
      if (!isRecord(record) || typeof record.id !== 'number') {
        throw new ExamImportError(
          'invalid_api_response',
          'create test thiếu id',
        );
      }
      testId = record.id;
      ledger.tests[demo.sourceKey] = { id: testId };
      created.tests += 1;
      save();
    }
    testIds[demo.sourceKey] = testId;
    if (options.dryRun) continue;
    const current = await api.request('GET', `/admin/cms/tests/${testId}`);
    const test =
      isRecord(current) && isRecord(current.test) ? current.test : current;
    if (!isRecord(test) || typeof test.updatedAt !== 'string') {
      throw new ExamImportError(
        'invalid_api_response',
        'GET test thiếu updatedAt',
      );
    }
    if (test.status !== 'draft') {
      log(
        `đề ${demo.sourceKey} không còn draft (${String(test.status)}), bỏ qua cấu trúc`,
      );
      continue;
    }
    const sections = options.file.sections
      .filter((section) => demo.sections.includes(section.skill))
      .map((section) => ({
        skill: section.skill,
        title: section.title,
        instruction: section.instruction,
        groups: section.parts.map((part) => ({
          title: part.title,
          instruction: part.instruction,
          audioId: null,
          imageId:
            part.imageKey === null ? null : (mediaIds[part.imageKey] ?? null),
          questionIds: part.questions.map((question) => {
            const id = questionIds[question.sourceKey];
            if (id === undefined) {
              throw new ExamImportError('question_missing', question.sourceKey);
            }
            return id;
          }),
        })),
      }));
    await api.request('PUT', `/admin/cms/tests/${testId}/structure`, {
      expectedUpdatedAt: test.updatedAt,
      sections,
    });
  }

  return { media: mediaIds, questions: questionIds, tests: testIds, created };
}
