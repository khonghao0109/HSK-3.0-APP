import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import type { LatencySample } from './metrics';

/**
 * M4.4 B1 — HTTP driver cho một học viên ảo.
 *
 * Chỉ dùng `fetch` toàn cục + `node:perf_hooks` (Node 24), không thêm dependency
 * (ADR-008). Mỗi request ghi một `LatencySample` để runner tính percentile;
 * driver không tự đánh giá PASS/FAIL theo ngưỡng — chỉ ghi lỗi giao thức.
 */

/** Nhãn route ổn định trong artifact (không chứa id thật). */
export const CAPACITY_ROUTES = {
  list: 'GET /exam/tests',
  intro: 'GET /exam/tests/:testId',
  start: 'POST /exam/tests/:testId/attempts',
  attempt: 'GET /exam/attempts/:id',
  save: 'PUT /exam/attempts/:id/answers/:key',
  saveBatch: 'PUT /exam/attempts/:id/answers',
  submit: 'POST /exam/attempts/:id/submit',
  result: 'GET /exam/attempts/:id/result',
} as const;

export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

/** `error.code` của envelope lỗi; null khi không có. */
export function parseErrorCode(payload: unknown): string | null {
  const root = asRecord(payload);
  const error = asRecord(root?.['error']);
  const code = error?.['code'];
  return typeof code === 'string' ? code : null;
}

/**
 * Lấy `questionKey` theo đúng thứ tự hiển thị từ `ExamAttemptView`.
 * Dùng chính response của server thay vì tự đoán `q1..qN`.
 */
export function extractQuestionKeys(attemptView: unknown): string[] {
  const data = asRecord(attemptView);
  const sections = data?.['sections'];
  if (!Array.isArray(sections)) return [];
  const keys: string[] = [];
  for (const section of sections) {
    const groups = asRecord(section)?.['groups'];
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const questions = asRecord(group)?.['questions'];
      if (!Array.isArray(questions)) continue;
      for (const question of questions) {
        const key = asRecord(question)?.['key'];
        if (typeof key === 'string') keys.push(key);
      }
    }
  }
  return keys;
}

/**
 * Fixture token không được server chấp nhận (401) — nghĩa là session/JWT fixture
 * lệch shape AuthService. Dừng toàn run thay vì đo tiếp bằng request 401.
 */
export class SessionFixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionFixtureError';
  }
}

export type HttpResult = {
  status: number;
  code: string | null;
  payload: unknown;
  durationMs: number;
};

export type ExamClient = {
  get(route: string, path: string, token: string): Promise<HttpResult>;
  post(
    route: string,
    path: string,
    token: string,
    body: unknown,
  ): Promise<HttpResult>;
  put(
    route: string,
    path: string,
    token: string,
    body: unknown,
  ): Promise<HttpResult>;
};

export function createExamClient(input: {
  baseUrl: string;
  timeoutMs: number;
  samples: LatencySample[];
}): ExamClient {
  const send = async (
    method: 'GET' | 'POST' | 'PUT',
    route: string,
    path: string,
    token: string,
    body: unknown,
  ): Promise<HttpResult> => {
    const startedAtEpochMs = Date.now();
    const startedAt = performance.now();
    let status = 0;
    let payload: unknown = null;
    let code: string | null = null;
    try {
      const response = await fetch(`${input.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(input.timeoutMs),
      });
      status = response.status;
      payload = await response.json().catch(() => null);
      if (!response.ok) code = parseErrorCode(payload);
    } catch (error: unknown) {
      code =
        error instanceof Error && error.name === 'TimeoutError'
          ? 'CLIENT_TIMEOUT'
          : 'NETWORK_ERROR';
    }
    const durationMs = performance.now() - startedAt;
    input.samples.push({
      route,
      method,
      path,
      status,
      code,
      durationMs,
      startedAtMs: startedAtEpochMs,
    });
    if (status === 401) {
      throw new SessionFixtureError(
        `session fixture lệch shape AuthService: 401 at ${method} ${path}`,
      );
    }
    return { status, code, payload, durationMs };
  };

  return {
    get: (route, path, token) => send('GET', route, path, token, undefined),
    post: (route, path, token, body) => send('POST', route, path, token, body),
    put: (route, path, token, body) => send('PUT', route, path, token, body),
  };
}

export type LearnerFixture = {
  index: number;
  userId: number;
  email: string;
  accessToken: string;
};

export type LearnerMode = 'full' | 'browse' | 'timeout';

export type ReconnectPlan = {
  /** Sau bao nhiêu câu thì giả lập reload: GET attempt + batch phần còn lại. */
  afterAnswers: number;
  /** Kích thước lô batch (route PUT /answers giới hạn 20). */
  batchSize: number;
};

export type LearnerRun = {
  index: number;
  userId: number;
  attemptId: number | null;
  mode: LearnerMode;
  /** Số câu harness yêu cầu trả lời (--questions), không phải số server trả về. */
  requestedAnswerCount: number;
  savedQuestionKeys: string[];
  completed: boolean;
  failures: string[];
};

export type LearnerLifecycleOptions = {
  mode?: LearnerMode;
  reconnect?: ReconnectPlan;
  /** W4: mốc epoch chung bắt đầu cửa sổ submit. */
  submitAtEpochMs?: number;
  /** W4: offset của học viên trong cửa sổ submit. */
  submitOffsetMs?: number;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function expectStatus(
  failures: string[],
  label: string,
  result: HttpResult,
  allowed: readonly number[],
): boolean {
  if (allowed.includes(result.status)) return true;
  failures.push(
    `${label}: expected ${allowed.join('/')}, got ${String(result.status)}${
      result.code === null ? '' : ` (${result.code})`
    }`,
  );
  return false;
}

function answerBody(): { answer: { choice: string }; isFlagged: boolean } {
  return { answer: { choice: 'a' }, isFlagged: false };
}

type BatchAnswer = {
  questionKey: string;
  answer: { choice: string };
  isFlagged: boolean;
  expectedVersion: null;
  idempotencyKey: string;
};

/**
 * W3: lưu phần còn lại bằng route batch sau khi GET attempt (giả lập reload).
 * Trả về các questionKey đã được server xác nhận saved/replayed.
 */
async function saveRemainingByBatch(input: {
  client: ExamClient;
  token: string;
  attemptId: number;
  questionKeys: readonly string[];
  batchSize: number;
  failures: string[];
}): Promise<string[]> {
  const acked: string[] = [];
  const size = Math.max(1, Math.min(20, input.batchSize));
  for (let start = 0; start < input.questionKeys.length; start += size) {
    const chunk = input.questionKeys.slice(start, start + size);
    const items: BatchAnswer[] = chunk.map((questionKey) => ({
      questionKey,
      ...answerBody(),
      expectedVersion: null,
      idempotencyKey: randomUUID(),
    }));
    const response = await input.client.put(
      CAPACITY_ROUTES.saveBatch,
      `/exam/attempts/${String(input.attemptId)}/answers`,
      input.token,
      { items },
    );
    if (!expectStatus(input.failures, 'saveBatch', response, [200]))
      return acked;
    const results = asRecord(asRecord(response.payload)?.['data'])?.['results'];
    if (!Array.isArray(results)) {
      input.failures.push('saveBatch: response has no results');
      return acked;
    }
    const byKey = new Map<string, string>();
    for (const entry of results) {
      const record = asRecord(entry);
      const key = record?.['questionKey'];
      const status = record?.['status'];
      if (typeof key === 'string' && typeof status === 'string') {
        byKey.set(key, status);
      }
    }
    for (const questionKey of chunk) {
      const status = byKey.get(questionKey);
      if (status === 'saved' || status === 'replayed') {
        acked.push(questionKey);
      } else {
        input.failures.push(
          `saveBatch ${questionKey}: unexpected item status ${status ?? 'missing'}`,
        );
      }
    }
  }
  return acked;
}

async function saveSingle(input: {
  client: ExamClient;
  token: string;
  attemptId: number;
  questionKey: string;
  failures: string[];
}): Promise<boolean> {
  const saved = await input.client.put(
    CAPACITY_ROUTES.save,
    `/exam/attempts/${String(input.attemptId)}/answers/${input.questionKey}`,
    input.token,
    {
      ...answerBody(),
      expectedVersion: null,
      idempotencyKey: randomUUID(),
    },
  );
  if (
    !expectStatus(input.failures, `save ${input.questionKey}`, saved, [200])
  ) {
    return false;
  }
  return true;
}

/**
 * Vòng đời một học viên ảo, tham số hoá theo kịch bản:
 * - `full`: list → intro → start → GET attempt → N answer → submit → result;
 *   có thể chèn reload + batch (W3) hoặc chờ cửa sổ submit (W4).
 * - `timeout` (W5): trả lời hết, không submit, chờ hết giờ rồi GET result để
 *   server chấm lười.
 * - `browse` (W7): chỉ list + intro trước giờ thi.
 */
export async function runLearnerLifecycle(
  input: {
    client: ExamClient;
    learner: LearnerFixture;
    testId: number;
    answerCount: number;
    answerIntervalMs: number;
  } & LearnerLifecycleOptions,
): Promise<LearnerRun> {
  const { client, learner } = input;
  const mode = input.mode ?? 'full';
  const failures: string[] = [];
  const token = learner.accessToken;
  const run: LearnerRun = {
    index: learner.index,
    userId: learner.userId,
    attemptId: null,
    mode,
    requestedAnswerCount: input.answerCount,
    savedQuestionKeys: [],
    completed: false,
    failures,
  };

  const list = await client.get(
    CAPACITY_ROUTES.list,
    '/exam/tests?page=1&limit=20',
    token,
  );
  expectStatus(failures, 'list', list, [200]);

  const intro = await client.get(
    CAPACITY_ROUTES.intro,
    `/exam/tests/${String(input.testId)}`,
    token,
  );
  if (!expectStatus(failures, 'intro', intro, [200])) return run;

  if (mode === 'browse') {
    // W7: học viên xem danh sách/giới thiệu đề trước giờ thi (2 lượt).
    const againList = await client.get(
      CAPACITY_ROUTES.list,
      '/exam/tests?page=1&limit=20',
      token,
    );
    expectStatus(failures, 'list#2', againList, [200]);
    const againIntro = await client.get(
      CAPACITY_ROUTES.intro,
      `/exam/tests/${String(input.testId)}`,
      token,
    );
    expectStatus(failures, 'intro#2', againIntro, [200]);
    run.completed = failures.length === 0;
    return run;
  }

  const started = await client.post(
    CAPACITY_ROUTES.start,
    `/exam/tests/${String(input.testId)}/attempts`,
    token,
    { idempotencyKey: randomUUID() },
  );
  if (!expectStatus(failures, 'start', started, [200, 201])) return run;
  const startedData = asRecord(asRecord(started.payload)?.['data']);
  const attemptId = startedData?.['id'];
  if (typeof attemptId !== 'number') {
    failures.push('start: response has no numeric data.id');
    return run;
  }
  run.attemptId = attemptId;

  const attempt = await client.get(
    CAPACITY_ROUTES.attempt,
    `/exam/attempts/${String(attemptId)}`,
    token,
  );
  if (!expectStatus(failures, 'attempt', attempt, [200])) return run;

  const view = asRecord(attempt.payload)?.['data'];
  const questionKeys = extractQuestionKeys(view);
  if (questionKeys.length < input.answerCount) {
    failures.push(
      `attempt: ${String(questionKeys.length)} question keys < ${String(input.answerCount)} requested`,
    );
    return run;
  }

  const reconnectAt =
    input.reconnect === undefined
      ? -1
      : Math.min(input.reconnect.afterAnswers, input.answerCount);
  for (let index = 0; index < input.answerCount; index += 1) {
    if (index === reconnectAt) {
      // W3: reload giữa bài — GET attempt rồi batch phần còn lại.
      const reloaded = await client.get(
        CAPACITY_ROUTES.attempt,
        `/exam/attempts/${String(attemptId)}`,
        token,
      );
      if (!expectStatus(failures, 'reload', reloaded, [200])) return run;
      const acked = await saveRemainingByBatch({
        client,
        token,
        attemptId,
        questionKeys: questionKeys.slice(index, input.answerCount),
        batchSize: input.reconnect?.batchSize ?? 20,
        failures,
      });
      run.savedQuestionKeys.push(...acked);
      break;
    }
    const questionKey = questionKeys[index];
    const ok = await saveSingle({
      client,
      token,
      attemptId,
      questionKey,
      failures,
    });
    if (!ok) return run;
    run.savedQuestionKeys.push(questionKey);
    if (index < input.answerCount - 1 && input.answerIntervalMs > 0) {
      await sleep(input.answerIntervalMs);
    }
  }

  if (run.savedQuestionKeys.length !== input.answerCount) {
    failures.push(
      `saved ${String(run.savedQuestionKeys.length)}/${String(input.answerCount)} answers`,
    );
  }

  if (mode === 'timeout') {
    // W5: không submit; chờ hết hạn + grace 5 s rồi GET result (server tự
    // chuyển timed_out và chấm lười ở lần đọc đầu tiên).
    const remaining = startedData?.['remainingSeconds'];
    const waitMs =
      (typeof remaining === 'number' ? remaining : 0) * 1_000 + 6_000;
    if (waitMs > 0) await sleep(waitMs);
    const result = await client.get(
      CAPACITY_ROUTES.result,
      `/exam/attempts/${String(attemptId)}/result`,
      token,
    );
    expectStatus(failures, 'result-after-timeout', result, [200]);
    run.completed = failures.length === 0;
    return run;
  }

  if (input.submitAtEpochMs !== undefined) {
    const target = input.submitAtEpochMs + (input.submitOffsetMs ?? 0);
    const waitMs = target - Date.now();
    if (waitMs > 0) await sleep(waitMs);
  }

  const submitted = await client.post(
    CAPACITY_ROUTES.submit,
    `/exam/attempts/${String(attemptId)}/submit`,
    token,
    { idempotencyKey: randomUUID() },
  );
  expectStatus(failures, 'submit', submitted, [200]);

  const result = await client.get(
    CAPACITY_ROUTES.result,
    `/exam/attempts/${String(attemptId)}/result`,
    token,
  );
  expectStatus(failures, 'result', result, [200]);

  run.completed = failures.length === 0;
  return run;
}
