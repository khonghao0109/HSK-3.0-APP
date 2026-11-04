import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendLockWaitDetails,
  INVARIANT_NAMES,
  LOCK_WAIT_DETAIL_LIMIT,
  type LockWaitDetail,
} from './fixtures';
import {
  percentile,
  renderSummaryMarkdown,
  summarizeSamples,
  type CapacitySummaryInput,
  type LatencySample,
  type RouteSummary,
} from './metrics';
import { calculatePeakRequestsPerMinute } from './preload-planner';
import { REQUIRED_THRESHOLD_CODES, requiredThresholdCodes } from './scenarios';
import {
  evaluateThresholds,
  isThresholdsPassing,
  renderThresholdsMarkdownTable,
  type EvaluateThresholdsInput,
} from './thresholds';

function sample(input: Partial<LatencySample>): LatencySample {
  return {
    route: 'GET /exam/tests',
    method: 'GET',
    path: '/exam/tests',
    status: 200,
    code: null,
    durationMs: 1,
    ...input,
  };
}

type ThresholdInvariantFixture = EvaluateThresholdsInput['invariants'][number];

function invariant(
  name: string,
  ok: boolean,
  detail: string,
  applicable = true,
): ThresholdInvariantFixture {
  return { name, ok, detail, applicable };
}

function routeSummary(
  route: string,
  count: number,
  p95Ms: number,
  p99Ms: number,
  status = '200',
): RouteSummary {
  return {
    route,
    count,
    p50Ms: p95Ms,
    p95Ms,
    p99Ms,
    maxMs: p99Ms,
    statusCounts: { [status]: count },
    errorCodes: {},
    serverErrors: 0,
    rateLimited: 0,
  };
}

/** Đủ route cho w1..w6/w45: đọc, start, autosave, submit, result. */
function completeRouteSummaries(): RouteSummary[] {
  return [
    routeSummary('GET /exam/tests', 40, 28, 50),
    routeSummary('POST /exam/tests/:testId/attempts', 40, 50, 70, '201'),
    routeSummary('PUT /exam/attempts/:id/answers/:key', 3200, 45, 65),
    routeSummary('POST /exam/attempts/:id/submit', 40, 55, 75),
    routeSummary('GET /exam/attempts/:id/result', 40, 20, 30),
  ];
}

function passingDatabase(): EvaluateThresholdsInput['database'] {
  return {
    deadlocksBefore: 0,
    deadlocksAfter: 0,
    maxConnections: 18,
    maxTotalConnections: 20,
    maxLockWaits: 0,
    samples: 100,
    samplerErrors: 0,
    lockWaitDetails: { kept: [], total: 0 },
  };
}

void test('percentile trả null khi không có mẫu', () => {
  assert.equal(percentile([], 95), null);
});

void test('percentile một mẫu trả chính mẫu đó cho mọi p', () => {
  assert.equal(percentile([7], 50), 7);
  assert.equal(percentile([7], 95), 7);
  assert.equal(percentile([7], 100), 7);
});

void test('percentile dùng nearest-rank, mẫu trùng giữ nguyên giá trị', () => {
  const values = [1, 2, 3, 4];
  assert.equal(percentile(values, 25), 1);
  assert.equal(percentile(values, 50), 2);
  assert.equal(percentile(values, 75), 3);
  assert.equal(percentile(values, 100), 4);
  assert.equal(percentile([5, 5, 5, 5], 95), 5);
});

void test('percentile 1..100 cho p95 = 95 và p99 = 99', () => {
  const values = Array.from({ length: 100 }, (_value, index) => index + 1);
  assert.equal(percentile(values, 50), 50);
  assert.equal(percentile(values, 95), 95);
  assert.equal(percentile(values, 99), 99);
});

void test('percentile từ chối p ngoài (0, 100]', () => {
  assert.throws(() => percentile([1, 2], 0), RangeError);
  assert.throws(() => percentile([1, 2], 101), RangeError);
  assert.throws(() => percentile([1, 2], Number.NaN), RangeError);
});

void test('summarizeSamples gộp theo route, đếm status và mã lỗi', () => {
  const samples = [
    sample({ durationMs: 10 }),
    sample({ durationMs: 20 }),
    sample({ durationMs: 30, status: 500, code: 'INTERNAL_ERROR' }),
    sample({ durationMs: 40, status: 429, code: 'RATE_LIMITED' }),
    sample({ route: 'PUT /exam/attempts/:id/answers/:key', durationMs: 5 }),
  ];
  const summary = summarizeSamples(samples);
  assert.equal(summary.length, 2);
  const list = summary.find((entry) => entry.route === 'GET /exam/tests');
  assert.ok(list);
  assert.equal(list.count, 4);
  assert.equal(list.statusCounts['200'], 2);
  assert.equal(list.statusCounts['500'], 1);
  assert.equal(list.statusCounts['429'], 1);
  assert.equal(list.serverErrors, 1);
  assert.equal(list.rateLimited, 1);
  assert.equal(list.errorCodes['INTERNAL_ERROR'], 1);
  assert.equal(list.p50Ms, 20);
  assert.equal(list.p95Ms, 40);
  assert.equal(list.maxMs, 40);
  const answers = summary.find(
    (entry) => entry.route === 'PUT /exam/attempts/:id/answers/:key',
  );
  assert.ok(answers);
  assert.equal(answers.count, 1);
  assert.equal(answers.p95Ms, 5);
});

void test('renderSummaryMarkdown chứa cấu hình, trần hiệu lực và bảng route', () => {
  const input: CapacitySummaryInput = {
    label: 'w1-smoke',
    startedAt: '2026-11-02T15:00:00.000Z',
    finishedAt: '2026-11-02T15:10:00.000Z',
    nodeVersion: 'v24.21.0',
    serverPid: 1234,
    serverEnvironment: 'production',
    baseUrl: 'http://127.0.0.1:4310/api/v1',
    config: {
      scenario: 'w1',
      reconnectRatio: 0.2,
      timeoutRatio: 0.3,
      submitWindowSeconds: 300,
      connectionLimit: 'default',
      users: 5,
      rampSeconds: 10,
      questions: 80,
      minutes: 90,
      answerIntervalMs: 54_000,
      audioPerTest: 0,
      imagesPerTest: 0,
    },
    effectiveLimits: [
      'global default: 20/phút/user',
      'exam save: 240/phút/user',
    ],
    loadAverageStart: '1.2 1.1 1.0',
    loadAverageEnd: '2.3 2.0 1.8',
    routeSummaries: summarizeSamples([
      sample({ durationMs: 10 }),
      sample({ durationMs: 20 }),
    ]),
    serverRssKb: { firstKb: 100_000, lastKb: 120_000, peakKb: 125_000 },
    database: {
      deadlocksBefore: 0,
      deadlocksAfter: 0,
      maxConnections: 9,
      maxTotalConnections: 11,
      maxLockWaits: 2,
      samples: 10,
      samplerErrors: 0,
      lockWaitDetails: { kept: [], total: 0 },
    },
    invariants: [
      { name: 'one in-progress attempt per learner', ok: true, detail: 'ok' },
    ],
    totalRequests: 2,
  };
  const markdown = renderSummaryMarkdown(input);
  assert.match(markdown, /^# Capacity run w1-smoke/mu);
  assert.match(markdown, /production/u);
  assert.match(markdown, /global default: 20\/phút\/user/u);
  assert.match(markdown, /GET \/exam\/tests/u);
  assert.match(markdown, /deadlocks: 0 → 0/u);
  assert.match(markdown, /one in-progress attempt per learner/u);
  assert.match(markdown, /PASS|FAIL/u);
});

void test('renderSummaryMarkdown hiển thị bảng chẩn đoán khi có lock wait', () => {
  const input: CapacitySummaryInput = {
    label: 'w6-lock-diagnostics',
    startedAt: '2026-11-04T00:00:00.000Z',
    finishedAt: '2026-11-04T00:10:00.000Z',
    nodeVersion: 'v24.21.0',
    serverPid: 12345,
    serverEnvironment: 'production',
    baseUrl: 'http://127.0.0.1:4310',
    config: {
      users: 40,
      rampSeconds: 120,
      questions: 40,
      minutes: 10,
      answerIntervalMs: 12000,
      scenario: 'w6',
      reconnectRatio: 0,
      timeoutRatio: 0,
      submitWindowSeconds: 0,
      connectionLimit: 'default',
      audioPerTest: 10,
      imagesPerTest: 4,
    },
    effectiveLimits: [],
    loadAverageStart: '1.00 1.00 1.00',
    loadAverageEnd: '1.00 1.00 1.00',
    routeSummaries: [],
    serverRssKb: { firstKb: 100_000, lastKb: 120_000, peakKb: 125_000 },
    database: {
      deadlocksBefore: 0,
      deadlocksAfter: 0,
      maxConnections: 9,
      maxTotalConnections: 11,
      maxLockWaits: 1,
      samples: 10,
      samplerErrors: 0,
      lockWaitDetails: {
        kept: [
          {
            sampledAt: '2026-11-04T00:05:00.000Z',
            pid: 4321,
            waitEventType: 'Lock',
            waitEvent: 'transactionid',
            state: 'active',
            queryAgeMs: 45,
            xactAgeMs: 90,
            query: 'UPDATE "ExamAnswer" SET value = $1',
            blockingPids: [9876],
            blockers: [
              {
                pid: 9876,
                waitEvent: null,
                state: 'idle in transaction',
                query: 'COMMIT',
              },
            ],
          },
        ],
        total: 1,
      },
    },
    invariants: [],
    totalRequests: 10,
  };
  const markdown = renderSummaryMarkdown(input);
  assert.match(markdown, /## Chẩn đoán lock wait/u);
  assert.match(markdown, /Số lần sampler thấy lock wait: 1/u);
  assert.match(markdown, /UPDATE "ExamAnswer"/u);
  assert.match(markdown, /pid 9876/u);
});

void test('calculatePeakRequestsPerMinute tính đúng cửa sổ trượt', () => {
  assert.equal(calculatePeakRequestsPerMinute([]), 0);
  assert.equal(calculatePeakRequestsPerMinute([1000]), 1);

  // 5 request trong 10 giây -> peak là 5
  const quick = [0, 2000, 4000, 6000, 8000];
  assert.equal(calculatePeakRequestsPerMinute(quick, 60_000), 5);

  // 10 request rải đều qua 180s:
  // [0, 10s, 20s, 70s, 80s, 90s, 100s, 110s, 160s, 170s]
  // Cửa sổ [60s, 120s] có 5 request (70, 80, 90, 100, 110)
  const spread = [
    0, 10_000, 20_000, 70_000, 80_000, 90_000, 100_000, 110_000, 160_000,
    170_000,
  ];
  assert.equal(calculatePeakRequestsPerMinute(spread, 60_000), 5);
});

void test('evaluateThresholds đánh giá PASS khi mọi số đo đạt chuẩn', () => {
  const input: EvaluateThresholdsInput = {
    scenario: 'w1',
    routeSummaries: [
      {
        route: 'GET /exam/tests',
        count: 40,
        p50Ms: 15,
        p95Ms: 28,
        p99Ms: 50,
        maxMs: 60,
        statusCounts: { '200': 40 },
        errorCodes: {},
        serverErrors: 0,
        rateLimited: 0,
      },
      {
        route: 'POST /exam/tests/:testId/attempts',
        count: 40,
        p50Ms: 35,
        p95Ms: 50,
        p99Ms: 70,
        maxMs: 80,
        statusCounts: { '201': 40 },
        errorCodes: {},
        serverErrors: 0,
        rateLimited: 0,
      },
      {
        route: 'PUT /exam/attempts/:id/answers/:key',
        count: 3200,
        p50Ms: 25,
        p95Ms: 45,
        p99Ms: 65,
        maxMs: 120,
        statusCounts: { '200': 3200 },
        errorCodes: {},
        serverErrors: 0,
        rateLimited: 0,
      },
      {
        route: 'POST /exam/attempts/:id/submit',
        count: 40,
        p50Ms: 30,
        p95Ms: 55,
        p99Ms: 75,
        maxMs: 90,
        statusCounts: { '200': 40 },
        errorCodes: {},
        serverErrors: 0,
        rateLimited: 0,
      },
      {
        route: 'GET /exam/attempts/:id/result',
        count: 40,
        p50Ms: 12,
        p95Ms: 20,
        p99Ms: 30,
        maxMs: 40,
        statusCounts: { '200': 40 },
        errorCodes: {},
        serverErrors: 0,
        rateLimited: 0,
      },
    ],
    database: {
      deadlocksBefore: 0,
      deadlocksAfter: 0,
      maxConnections: 18,
      maxTotalConnections: 20,
      maxLockWaits: 0,
      samples: 100,
      samplerErrors: 0,
      lockWaitDetails: { kept: [], total: 0 },
    },
    serverRssKb: { firstKb: 200_000, lastKb: 150_000, peakKb: 250_000 },
    invariants: [
      invariant(INVARIANT_NAMES.ANSWER_COUNT, true, 'ok'),
      invariant(INVARIANT_NAMES.SINGLE_RESULT, true, 'ok'),
      invariant(INVARIANT_NAMES.SINGLE_IN_PROGRESS, true, 'ok'),
    ],
  };

  const evals = evaluateThresholds(input);
  assert.equal(isThresholdsPassing(evals), true);
  const p5 = evals.find((item) => item.code === 'P5');
  assert.equal(p5?.verdict, 'PASS');
  const p7 = evals.find((item) => item.code === 'P7');
  assert.equal(p7?.verdict, 'PASS');
  const p17 = evals.find((item) => item.code === 'P17');
  assert.equal(p17?.verdict, 'PASS');
  const rss = evals.find((item) => item.code === 'RSS');
  assert.equal(rss?.verdict, 'PASS');
  const p15 = evals.find((item) => item.code === 'P15');
  assert.equal(p15?.verdict, 'n/a');
});

void test('evaluateThresholds đánh dấu n/a khi route không có mẫu, không ghi PASS', () => {
  const input: EvaluateThresholdsInput = {
    scenario: 'w7',
    routeSummaries: [
      {
        route: 'GET /exam/tests',
        count: 10,
        p50Ms: 10,
        p95Ms: 20,
        p99Ms: 30,
        maxMs: 40,
        statusCounts: { '200': 10 },
        errorCodes: {},
        serverErrors: 0,
        rateLimited: 0,
      },
    ],
    database: {
      deadlocksBefore: 0,
      deadlocksAfter: 0,
      maxConnections: 5,
      maxTotalConnections: 7,
      maxLockWaits: 0,
      samples: 20,
      samplerErrors: 0,
      lockWaitDetails: { kept: [], total: 0 },
    },
    serverRssKb: { firstKb: 100_000, lastKb: 100_000, peakKb: 110_000 },
    invariants: [
      invariant(
        INVARIANT_NAMES.ANSWER_COUNT,
        true,
        'n/a (w7 không trả lời)',
        false,
      ),
      invariant(INVARIANT_NAMES.SINGLE_RESULT, true, 'ok'),
      invariant(INVARIANT_NAMES.SINGLE_IN_PROGRESS, true, 'ok'),
    ],
  };

  const evals = evaluateThresholds(input);
  const p7 = evals.find((item) => item.code === 'P7');
  assert.equal(p7?.verdict, 'n/a');
  assert.equal(p7?.observed, 'n/a (0 mẫu)');
  const p9 = evals.find((item) => item.code === 'P9');
  assert.equal(p9?.verdict, 'n/a');
  const p10 = evals.find((item) => item.code === 'P10');
  assert.equal(p10?.verdict, 'n/a');
  const p13 = evals.find((item) => item.code === 'P13');
  assert.equal(p13?.verdict, 'n/a');
});

void test('evaluateThresholds báo FAIL khi vi phạm p95, lock wait hoặc RSS', () => {
  const baseInput: EvaluateThresholdsInput = {
    scenario: 'w1',
    routeSummaries: [
      {
        route: 'GET /exam/tests',
        count: 40,
        p50Ms: 150,
        p95Ms: 350, // Vượt 300 ms
        p99Ms: 400,
        maxMs: 500,
        statusCounts: { '200': 40 },
        errorCodes: {},
        serverErrors: 0,
        rateLimited: 0,
      },
      {
        route: 'PUT /exam/attempts/:id/answers/:key',
        count: 100,
        p50Ms: 25,
        p95Ms: 45,
        p99Ms: 65,
        maxMs: 120,
        statusCounts: { '200': 100 },
        errorCodes: {},
        serverErrors: 0,
        rateLimited: 0,
      },
    ],
    database: {
      deadlocksBefore: 0,
      deadlocksAfter: 0,
      maxConnections: 25, // Vượt 22
      maxTotalConnections: 27,
      maxLockWaits: 1, // Vượt 0
      samples: 50,
      samplerErrors: 0,
      lockWaitDetails: { kept: [], total: 0 },
    },
    serverRssKb: { firstKb: 200_000, lastKb: 550_000, peakKb: 600_000 }, // 600 MiB vượt 512
    invariants: [
      invariant(INVARIANT_NAMES.ANSWER_COUNT, false, 'mất 2 answer'),
      invariant(INVARIANT_NAMES.SINGLE_RESULT, true, 'ok'),
      invariant(INVARIANT_NAMES.SINGLE_IN_PROGRESS, true, 'ok'),
    ],
  };

  const evals = evaluateThresholds(baseInput);
  assert.equal(isThresholdsPassing(evals), false);
  assert.equal(evals.find((item) => item.code === 'P5')?.verdict, 'FAIL');
  assert.equal(evals.find((item) => item.code === 'P13')?.verdict, 'FAIL');
  assert.equal(evals.find((item) => item.code === 'P17')?.verdict, 'FAIL');
  assert.equal(evals.find((item) => item.code === 'RSS')?.verdict, 'FAIL');

  const md = renderThresholdsMarkdownTable(evals);
  assert.match(md, /P5/u);
  assert.match(md, /FAIL/u);
});

void test('evaluateThresholds FAIL khi thiếu invariant P13, không trả n/a', () => {
  const input: EvaluateThresholdsInput = {
    scenario: 'w1',
    routeSummaries: completeRouteSummaries(),
    database: passingDatabase(),
    serverRssKb: { firstKb: 200_000, lastKb: 210_000, peakKb: 220_000 },
    invariants: [
      invariant(INVARIANT_NAMES.SINGLE_RESULT, true, 'ok'),
      invariant(INVARIANT_NAMES.SINGLE_IN_PROGRESS, true, 'ok'),
    ],
  };

  const evals = evaluateThresholds(input);
  const p13 = evals.find((item) => item.code === 'P13');
  assert.equal(p13?.verdict, 'FAIL');
  assert.equal(
    p13?.observed,
    `thiếu invariant ${INVARIANT_NAMES.ANSWER_COUNT}`,
  );
  assert.equal(isThresholdsPassing(evals), false);
});

void test('evaluateThresholds trả n/a cho invariant có applicable=false', () => {
  const input: EvaluateThresholdsInput = {
    scenario: 'w7',
    routeSummaries: [routeSummary('GET /exam/tests', 10, 20, 30)],
    database: passingDatabase(),
    serverRssKb: { firstKb: 100_000, lastKb: 100_000, peakKb: 110_000 },
    invariants: [
      invariant(
        INVARIANT_NAMES.ANSWER_COUNT,
        true,
        'n/a (w7 không trả lời)',
        false,
      ),
      invariant(INVARIANT_NAMES.SINGLE_RESULT, true, 'ok'),
      invariant(INVARIANT_NAMES.SINGLE_IN_PROGRESS, true, 'ok'),
    ],
  };

  const evals = evaluateThresholds(input);
  const p13 = evals.find((item) => item.code === 'P13');
  assert.equal(p13?.verdict, 'n/a');
  assert.equal(p13?.observed, 'n/a (w7 không trả lời)');
});

void test('evaluateThresholds FAIL khi mã bắt buộc của scenario có 0 mẫu', () => {
  const input: EvaluateThresholdsInput = {
    scenario: 'w1',
    routeSummaries: [
      routeSummary('GET /exam/tests', 40, 28, 50),
      routeSummary('PUT /exam/attempts/:id/answers/:key', 3200, 45, 65),
      routeSummary('POST /exam/attempts/:id/submit', 40, 55, 75),
      routeSummary('GET /exam/attempts/:id/result', 40, 20, 30),
    ],
    database: passingDatabase(),
    serverRssKb: { firstKb: 200_000, lastKb: 210_000, peakKb: 220_000 },
    invariants: [
      invariant(INVARIANT_NAMES.ANSWER_COUNT, true, 'ok'),
      invariant(INVARIANT_NAMES.SINGLE_RESULT, true, 'ok'),
      invariant(INVARIANT_NAMES.SINGLE_IN_PROGRESS, true, 'ok'),
    ],
  };

  const evals = evaluateThresholds(input);
  const p9 = evals.find((item) => item.code === 'P9');
  assert.equal(p9?.verdict, 'FAIL');
  assert.equal(p9?.observed, 'bắt buộc nhưng 0 mẫu');
  assert.equal(isThresholdsPassing(evals), false);
});

void test('evaluateThresholds giữ n/a cho mã không bắt buộc có 0 mẫu', () => {
  const input: EvaluateThresholdsInput = {
    scenario: 'w7',
    routeSummaries: [routeSummary('GET /exam/tests', 10, 20, 30)],
    database: passingDatabase(),
    serverRssKb: { firstKb: 100_000, lastKb: 100_000, peakKb: 110_000 },
    invariants: [
      invariant(
        INVARIANT_NAMES.ANSWER_COUNT,
        true,
        'n/a (w7 không trả lời)',
        false,
      ),
      invariant(INVARIANT_NAMES.SINGLE_RESULT, true, 'ok'),
      invariant(INVARIANT_NAMES.SINGLE_IN_PROGRESS, true, 'ok'),
    ],
  };

  const evals = evaluateThresholds(input);
  const p7 = evals.find((item) => item.code === 'P7');
  assert.equal(p7?.verdict, 'n/a');
  assert.equal(p7?.observed, 'n/a (0 mẫu)');
  assert.equal(evals.find((item) => item.code === 'P5')?.verdict, 'PASS');
});

void test('probe429: P13 n/a vì ANSWER_COUNT applicable=false', () => {
  const input: EvaluateThresholdsInput = {
    scenario: 'probe429',
    routeSummaries: [
      routeSummary('GET /exam/tests', 10, 20, 30),
      routeSummary('POST /exam/tests/:testId/attempts', 2, 30, 40, '201'),
      routeSummary('PUT /exam/attempts/:id/answers/:key', 245, 25, 35),
    ],
    database: passingDatabase(),
    serverRssKb: { firstKb: 200_000, lastKb: 210_000, peakKb: 220_000 },
    invariants: [
      invariant(INVARIANT_NAMES.ANSWER_COUNT, true, 'n/a (probe429)', false),
      invariant(INVARIANT_NAMES.SINGLE_RESULT, true, 'ok'),
      invariant(INVARIANT_NAMES.SINGLE_IN_PROGRESS, true, 'ok'),
    ],
    probe429: {
      autosave200Count: 240,
      autosaveFirst429At: 241,
      autosaveErrorCode: 'TOO_MANY_REQUESTS',
      learner2Errors429: 0,
      media200Count: 600,
      mediaFirst429At: 601,
      ok: true,
      detail: 'ok',
    },
  };

  const evals = evaluateThresholds(input);
  assert.equal(evals.find((item) => item.code === 'P13')?.verdict, 'n/a');
  assert.equal(isThresholdsPassing(evals), true);
});

void test('requiredThresholdCodes từ chối scenario lạ', () => {
  assert.throws(
    () => requiredThresholdCodes('w2'),
    /unknown capacity scenario: w2/u,
  );
  assert.throws(
    () =>
      evaluateThresholds({
        scenario: 'w2',
        routeSummaries: [],
        database: passingDatabase(),
        serverRssKb: { firstKb: null, lastKb: null, peakKb: null },
        invariants: [],
      }),
    /unknown capacity scenario: w2/u,
  );
});

void test('REQUIRED_THRESHOLD_CODES khớp bảng chốt theo scenario', () => {
  assert.deepStrictEqual(REQUIRED_THRESHOLD_CODES, {
    w1: [
      'P5',
      'P6',
      'P7',
      'P8',
      'P9',
      'P10',
      'P11',
      'P13',
      'P14',
      'P17',
      'RSS',
    ],
    w3: [
      'P5',
      'P6',
      'P7',
      'P8',
      'P9',
      'P10',
      'P11',
      'P13',
      'P14',
      'P17',
      'RSS',
    ],
    w4: [
      'P5',
      'P6',
      'P7',
      'P8',
      'P9',
      'P10',
      'P11',
      'P13',
      'P14',
      'P17',
      'RSS',
    ],
    w5: ['P5', 'P6', 'P7', 'P8', 'P9', 'P11', 'P13', 'P14', 'P17', 'RSS'],
    w7: ['P5', 'P6', 'P17', 'RSS'],
    w6: [
      'P5',
      'P6',
      'P7',
      'P8',
      'P9',
      'P10',
      'P11',
      'P13',
      'P14',
      'P17',
      'RSS',
    ],
    w45: [
      'P5',
      'P6',
      'P7',
      'P8',
      'P9',
      'P10',
      'P11',
      'P13',
      'P14',
      'P17',
      'RSS',
    ],
    probe429: ['P5', 'P6', 'P7', 'P8', 'P9', 'P14', 'P17', 'RSS'],
  });
});

void test('appendLockWaitDetails cắt 20 bản ghi nhưng vẫn đếm đủ', () => {
  const record = (index: number): LockWaitDetail => ({
    sampledAt: `2026-11-04T00:00:${String(index).padStart(2, '0')}.000Z`,
    pid: 1000 + index,
    waitEventType: 'Lock',
    waitEvent: 'transactionid',
    state: 'active',
    queryAgeMs: index,
    xactAgeMs: index * 2,
    query: `select ${String(index)}`,
    blockingPids: [9999],
    blockers: [
      { pid: 9999, waitEvent: null, state: 'idle in transaction', query: 'x' },
    ],
  });

  assert.deepStrictEqual(appendLockWaitDetails({ kept: [], total: 0 }, []), {
    kept: [],
    total: 0,
  });

  const once = appendLockWaitDetails(
    { kept: [], total: 0 },
    Array.from({ length: 25 }, (_value, index) => record(index)),
  );
  assert.equal(once.kept.length, LOCK_WAIT_DETAIL_LIMIT);
  assert.equal(once.total, 25);

  let incremental: { kept: LockWaitDetail[]; total: number } = {
    kept: [],
    total: 0,
  };
  for (let batch = 0; batch < 5; batch += 1) {
    incremental = appendLockWaitDetails(
      incremental,
      Array.from({ length: 5 }, (_value, index) => record(batch * 5 + index)),
    );
  }
  assert.equal(incremental.kept.length, LOCK_WAIT_DETAIL_LIMIT);
  assert.equal(incremental.total, 25);
  assert.equal(incremental.kept[0]?.pid, 1000);
});
