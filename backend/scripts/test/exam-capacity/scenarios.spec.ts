import assert from 'node:assert/strict';
import test from 'node:test';

import {
  defaultAnswerIntervalMs,
  parseCapacityArgs,
  planStartOffsets,
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
