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
    });
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

export type LearnerRun = {
  index: number;
  userId: number;
  attemptId: number | null;
  /** Số câu harness yêu cầu trả lời (--questions), không phải số server trả về. */
  requestedAnswerCount: number;
  savedQuestionKeys: string[];
  completed: boolean;
  failures: string[];
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

/**
 * Vòng đời một học viên: list → intro → start → GET attempt → N lần PUT answer
 * (nhịp `answerIntervalMs`) → submit → result. Lỗi được ghi lại và vòng đời
 * dừng ở bước không thể tiếp tục; runner quyết định exit code từ invariant.
 */
export async function runLearnerLifecycle(input: {
  client: ExamClient;
  learner: LearnerFixture;
  testId: number;
  answerCount: number;
  answerIntervalMs: number;
}): Promise<LearnerRun> {
  const { client, learner } = input;
  const failures: string[] = [];
  const token = learner.accessToken;
  const run: LearnerRun = {
    index: learner.index,
    userId: learner.userId,
    attemptId: null,
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
    // Không clamp im lặng: thiếu key nghĩa là workload không chạy đủ và invariant
    // đối chiếu số answer sẽ vô nghĩa nếu expected lấy từ chính run này.
    failures.push(
      `attempt: ${String(questionKeys.length)} question keys < ${String(input.answerCount)} requested`,
    );
    return run;
  }
  for (let index = 0; index < input.answerCount; index += 1) {
    const questionKey = questionKeys[index];
    const saved = await client.put(
      CAPACITY_ROUTES.save,
      `/exam/attempts/${String(attemptId)}/answers/${questionKey}`,
      token,
      {
        answer: { choice: 'a' },
        isFlagged: false,
        expectedVersion: null,
        idempotencyKey: randomUUID(),
      },
    );
    if (!expectStatus(failures, `save ${questionKey}`, saved, [200]))
      return run;
    run.savedQuestionKeys.push(questionKey);
    if (index < input.answerCount - 1 && input.answerIntervalMs > 0) {
      await sleep(input.answerIntervalMs);
    }
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

  if (run.savedQuestionKeys.length !== input.answerCount) {
    failures.push(
      `saved ${String(run.savedQuestionKeys.length)}/${String(input.answerCount)} answers`,
    );
  }
  run.completed = failures.length === 0;
  return run;
}
