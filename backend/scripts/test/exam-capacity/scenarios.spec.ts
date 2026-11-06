import assert from 'node:assert/strict';
import test from 'node:test';

import { extractAudioPreloadList } from './preload-planner';
import {
  defaultAnswerIntervalMs,
  parseCapacityArgs,
  pickRatioIndices,
  planLearnerScenario,
  planStartOffsets,
  planSubmitWaveOffsets,
} from './scenarios';

void test('planStartOffsets rải đều trong cửa sổ ramp, bắt đầu ở 0', () => {
  const offsets = planStartOffsets(40, 120_000);
  assert.equal(offsets.length, 40);
  assert.equal(offsets[0], 0);
  assert.ok(offsets.every((offset) => offset >= 0 && offset < 120_000));
  for (let index = 1; index < offsets.length; index += 1) {
    assert.ok(offsets[index] > offsets[index - 1]);
  }
  assert.equal(offsets[offsets.length - 1], 117_000);
});

void test('planStartOffsets một user hoặc ramp = 0 đều bắt đầu ngay', () => {
  assert.deepEqual(planStartOffsets(1, 120_000), [0]);
  assert.deepEqual(planStartOffsets(5, 0), [0, 0, 0, 0, 0]);
  assert.deepEqual(planStartOffsets(0, 120_000), []);
});

void test('defaultAnswerIntervalMs theo nhịp Pha A (80% thời lượng đề)', () => {
  assert.equal(defaultAnswerIntervalMs(90, 80), 54_000);
  assert.equal(defaultAnswerIntervalMs(2, 8), 12_000);
  assert.equal(defaultAnswerIntervalMs(1, 200), 240);
  assert.equal(defaultAnswerIntervalMs(90, 0), 0);
});

void test('parseCapacityArgs dùng mặc định W1 khi không có tham số', () => {
  const args = parseCapacityArgs([]);
  assert.equal(args.users, 40);
  assert.equal(args.rampSeconds, 120);
  assert.equal(args.questions, 80);
  assert.equal(args.minutes, 90);
  assert.equal(args.audio, 0);
  assert.equal(args.images, 0);
  assert.equal(args.answerIntervalMs, 54_000);
  assert.equal(args.basePort, 4310);
  assert.equal(args.build, false);
  assert.equal(args.keepDatabase, false);
  assert.equal(args.label, 'w1');
});

void test('parseCapacityArgs đọc được mọi cờ và tính lại nhịp khi đổi đề', () => {
  const args = parseCapacityArgs([
    '--users',
    '5',
    '--ramp-seconds',
    '0',
    '--questions',
    '8',
    '--minutes',
    '2',
    '--audio',
    '2',
    '--images',
    '1',
    '--base-port',
    '4399',
    '--label',
    'smoke',
    '--build',
    '--keep-database',
  ]);
  assert.equal(args.users, 5);
  assert.equal(args.rampSeconds, 0);
  assert.equal(args.questions, 8);
  assert.equal(args.minutes, 2);
  assert.equal(args.audio, 2);
  assert.equal(args.images, 1);
  assert.equal(args.answerIntervalMs, 12_000);
  assert.equal(args.basePort, 4399);
  assert.equal(args.label, 'smoke');
  assert.equal(args.build, true);
  assert.equal(args.keepDatabase, true);
});

void test('parseCapacityArgs cho override nhịp và từ chối giá trị sai', () => {
  const args = parseCapacityArgs([
    '--questions',
    '8',
    '--minutes',
    '2',
    '--answer-interval-ms',
    '250',
  ]);
  assert.equal(args.answerIntervalMs, 250);

  assert.throws(() => parseCapacityArgs(['--users', '0']), /--users/u);
  assert.throws(
    () => parseCapacityArgs(['--questions', '201']),
    /--questions/u,
  );
  assert.throws(() => parseCapacityArgs(['--minutes', '301']), /--minutes/u);
  assert.throws(() => parseCapacityArgs(['--ramp-seconds', '-1']), /--ramp/u);
  assert.throws(() => parseCapacityArgs(['--bogus']), /Unknown argument/u);
  assert.throws(() => parseCapacityArgs(['--users']), /Missing value/u);
});

void test('pickRatioIndices chọn tập con rải đều, biên 0 và 1', () => {
  assert.deepEqual(pickRatioIndices(10, 0), []);
  assert.deepEqual(pickRatioIndices(10, 1), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(pickRatioIndices(10, 0.3), [0, 3, 6]);
  assert.deepEqual(
    pickRatioIndices(40, 0.25),
    [0, 4, 8, 12, 16, 20, 24, 28, 32, 36],
  );
  assert.throws(() => pickRatioIndices(10, -0.1), RangeError);
  assert.throws(() => pickRatioIndices(10, 1.1), RangeError);
});

void test('planSubmitWaveOffsets rải submit trong cửa sổ, không vượt biên', () => {
  const offsets = planSubmitWaveOffsets(10, 300_000);
  assert.equal(offsets.length, 10);
  assert.equal(offsets[0], 0);
  assert.equal(offsets[9], 270_000);
  assert.ok(offsets.every((offset) => offset >= 0 && offset < 300_000));
  for (let index = 1; index < offsets.length; index += 1) {
    assert.ok(offsets[index] > offsets[index - 1]);
  }
  assert.deepEqual(planSubmitWaveOffsets(5, 0), [0, 0, 0, 0, 0]);
});

void test('parseCapacityArgs đọc cờ B2 và validate scenario/ratio', () => {
  const defaults = parseCapacityArgs([]);
  assert.equal(defaults.scenario, 'w1');
  assert.equal(defaults.reconnectRatio, 0.2);
  assert.equal(defaults.timeoutRatio, 0.3);
  assert.equal(defaults.submitWindowSeconds, 300);

  const w4 = parseCapacityArgs([
    '--scenario',
    'w4',
    '--submit-window-seconds',
    '120',
    '--reconnect-ratio',
    '0.5',
    '--timeout-ratio',
    '0',
  ]);
  assert.equal(w4.scenario, 'w4');
  assert.equal(w4.submitWindowSeconds, 120);
  assert.equal(w4.reconnectRatio, 0.5);
  assert.equal(w4.timeoutRatio, 0);

  assert.throws(() => parseCapacityArgs(['--scenario', 'w9']), /--scenario/u);
  assert.throws(
    () => parseCapacityArgs(['--reconnect-ratio', '1.5']),
    /--reconnect-ratio/u,
  );
  assert.throws(
    () => parseCapacityArgs(['--timeout-ratio', 'abc']),
    /--timeout-ratio/u,
  );
  assert.throws(
    () => parseCapacityArgs(['--submit-window-seconds', '0']),
    /--submit-window-seconds/u,
  );
});

void test('parseCapacityArgs nhận scenario B3a (w6, w45, probe429) và cờ audio/images', () => {
  const w6 = parseCapacityArgs([
    '--scenario',
    'w6',
    '--audio',
    '40',
    '--images',
    '10',
    '--label',
    'smoke-w6',
  ]);
  assert.equal(w6.scenario, 'w6');
  assert.equal(w6.audio, 40);
  assert.equal(w6.images, 10);
  assert.equal(w6.label, 'smoke-w6');

  const w45 = parseCapacityArgs(['--scenario', 'w45']);
  assert.equal(w45.scenario, 'w45');

  const probe = parseCapacityArgs(['--scenario', 'probe429']);
  assert.equal(probe.scenario, 'probe429');

  assert.throws(() => parseCapacityArgs(['--audio', '-1']), /--audio/u);
  assert.throws(() => parseCapacityArgs(['--images', '201']), /--images/u);
});

void test('extractAudioPreloadList lọc đúng audio và loại trừ trùng lặp', () => {
  const grants = [
    { mediaId: 10, kind: 'audio', url: '/api/v1/media/10/content?expires=1' },
    { mediaId: 20, kind: 'image', url: '/api/v1/media/20/content?expires=1' },
    { mediaId: 10, kind: 'audio', url: '/api/v1/media/10/content?expires=2' },
    { mediaId: 30, kind: 'audio', url: '/api/v1/media/30/content?expires=1' },
  ];
  const list = extractAudioPreloadList(grants);
  assert.deepEqual(list, [
    { mediaId: 10, url: '/api/v1/media/10/content?expires=1' },
    { mediaId: 30, url: '/api/v1/media/30/content?expires=1' },
  ]);
});

void test('parseCapacityArgs nhận --scenario w8', () => {
  const args = parseCapacityArgs(['--scenario', 'w8', '--users', '5']);
  assert.equal(args.scenario, 'w8');
  assert.equal(args.users, 5);
});

void test('planLearnerScenario: w8 có kế hoạch học viên giống hệt w1 khi cùng cấu hình', () => {
  const config = {
    learnerCount: 12,
    rampSeconds: 30,
    answerCount: 40,
    reconnectRatio: 0.25,
    timeoutRatio: 0.3,
    submitWindowSeconds: 60,
  };
  const w1 = planLearnerScenario({ scenario: 'w1', ...config });
  const w8 = planLearnerScenario({ scenario: 'w8', ...config });
  assert.deepStrictEqual(w8, w1);
  assert.equal(w8.learners.length, 12);
  assert.ok(w8.learners.every((learner) => learner.mode === 'full'));
  // Kế hoạch phải nhạy với scenario: w3 (reconnect) và w45 (timeout + submit wave) khác w1.
  assert.notDeepStrictEqual(
    planLearnerScenario({ scenario: 'w3', ...config }),
    w1,
  );
  assert.notDeepStrictEqual(
    planLearnerScenario({ scenario: 'w45', ...config }),
    w1,
  );
});
