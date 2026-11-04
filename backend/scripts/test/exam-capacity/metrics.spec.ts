import assert from 'node:assert/strict';
import test from 'node:test';

import {
  percentile,
  renderSummaryMarkdown,
  summarizeSamples,
  type CapacitySummaryInput,
  type LatencySample,
} from './metrics';

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
