import {
  createExamClient,
  runLearnerLifecycle,
  type LearnerFixture,
  type LearnerRun,
} from './driver';
import type { LatencySample } from './metrics';

/**
 * M4.4 B1 — cấu hình kịch bản và bộ chạy học viên ảo.
 *
 * Phần thuần (offset ramp, nhịp answer mặc định, parse CLI) được unit test bằng
 * `node --test`; phần IO chỉ gọi driver HTTP và không tự đánh giá ngưỡng.
 */

export type CapacityScenario = 'w1' | 'w3' | 'w4' | 'w5' | 'w7';

export const CAPACITY_SCENARIOS: readonly CapacityScenario[] = [
  'w1',
  'w3',
  'w4',
  'w5',
  'w7',
];

export type CapacityArgs = {
  scenario: CapacityScenario;
  reconnectRatio: number;
  timeoutRatio: number;
  submitWindowSeconds: number;
  users: number;
  rampSeconds: number;
  questions: number;
  minutes: number;
  audio: number;
  images: number;
  answerIntervalMs: number;
  basePort: number;
  build: boolean;
  keepDatabase: boolean;
  label: string;
};

export const CAPACITY_DEFAULTS = {
  scenario: 'w1' as CapacityScenario,
  reconnectRatio: 0.2,
  timeoutRatio: 0.3,
  submitWindowSeconds: 300,
  users: 40,
  rampSeconds: 120,
  questions: 80,
  minutes: 90,
  audio: 0,
  images: 0,
  basePort: 4310,
  label: 'w1',
} as const;

/** Nhịp mặc định theo Pha A: 80% thời lượng đề chia cho số câu. */
export function defaultAnswerIntervalMs(
  minutes: number,
  questions: number,
): number {
  if (questions <= 0) return 0;
  return Math.floor((minutes * 60_000 * 0.8) / questions);
}

/**
 * Rải đều thời điểm bắt đầu trong `rampMs`. W1 dùng 120 s cho 40 học viên, tức
 * 100% bắt đầu trong cửa sổ 2 phút — siết hơn giả định 70% của Pha A.
 */
export function planStartOffsets(users: number, rampMs: number): number[] {
  if (users <= 0) return [];
  if (rampMs <= 0) return Array.from({ length: users }, () => 0);
  return Array.from({ length: users }, (_value, index) =>
    Math.floor((index * rampMs) / users),
  );
}

/**
 * Chọn tập con rải đều theo tỉ lệ (deterministic, không random): W3 dùng cho
 * reconnect, W5 cho timeout. `ratio=0` → rỗng, `ratio=1` → toàn bộ.
 */
export function pickRatioIndices(count: number, ratio: number): number[] {
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new RangeError('ratio must be in [0, 1]');
  }
  if (count <= 0 || ratio === 0) return [];
  const picked = Math.floor(count * ratio + 1e-9);
  if (picked <= 0) return [];
  if (picked >= count) return Array.from({ length: count }, (_v, i) => i);
  return Array.from({ length: picked }, (_v, index) =>
    Math.floor((index * count) / picked),
  );
}

/** W4: rải thời điểm submit của `count` học viên trong `windowMs`. */
export function planSubmitWaveOffsets(
  count: number,
  windowMs: number,
): number[] {
  if (count <= 0) return [];
  if (windowMs <= 0) return Array.from({ length: count }, () => 0);
  return Array.from({ length: count }, (_value, index) =>
    Math.floor((index * windowMs) / count),
  );
}

const KNOWN_FLAGS = new Set([
  '--users',
  '--ramp-seconds',
  '--questions',
  '--minutes',
  '--audio',
  '--images',
  '--answer-interval-ms',
  '--base-port',
  '--label',
  '--scenario',
  '--reconnect-ratio',
  '--timeout-ratio',
  '--submit-window-seconds',
]);

function readInteger(
  flag: string,
  raw: string,
  minimum: number,
  maximum: number,
): number {
  if (!/^\d+$/u.test(raw)) {
    throw new Error(
      `${flag} must be an integer between ${String(minimum)} and ${String(maximum)}`,
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${flag} must be an integer between ${String(minimum)} and ${String(maximum)}`,
    );
  }
  return value;
}

function readRatio(flag: string, raw: string): number {
  if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/u.test(raw)) {
    throw new Error(`${flag} must be a ratio in [0, 1]`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${flag} must be a ratio in [0, 1]`);
  }
  return value;
}

/**
 * Parse CLI. Mặc định = W1 của Pha A (40 users, ramp 120 s, đề 80 câu/90 phút,
 * không media). `--answer-interval-ms` mặc định suy ra từ nhịp Pha A.
 */
export function parseCapacityArgs(argv: readonly string[]): CapacityArgs {
  const values = new Map<string, string>();
  let build = false;
  let keepDatabase = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--build') {
      build = true;
      continue;
    }
    if (argument === '--keep-database') {
      keepDatabase = true;
      continue;
    }
    if (!argument.startsWith('--') || !KNOWN_FLAGS.has(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const rawValue = argv[index + 1];
    if (rawValue === undefined || rawValue.startsWith('--')) {
      throw new Error(`Missing value for ${argument}`);
    }
    values.set(argument, rawValue);
    index += 1;
  }

  const users = values.has('--users')
    ? readInteger('--users', values.get('--users')!, 1, 1_000)
    : CAPACITY_DEFAULTS.users;
  const rampSeconds = values.has('--ramp-seconds')
    ? readInteger('--ramp-seconds', values.get('--ramp-seconds')!, 0, 3_600)
    : CAPACITY_DEFAULTS.rampSeconds;
  const questions = values.has('--questions')
    ? readInteger('--questions', values.get('--questions')!, 1, 200)
    : CAPACITY_DEFAULTS.questions;
  const minutes = values.has('--minutes')
    ? readInteger('--minutes', values.get('--minutes')!, 1, 300)
    : CAPACITY_DEFAULTS.minutes;
  const audio = values.has('--audio')
    ? readInteger('--audio', values.get('--audio')!, 0, 200)
    : CAPACITY_DEFAULTS.audio;
  const images = values.has('--images')
    ? readInteger('--images', values.get('--images')!, 0, 200)
    : CAPACITY_DEFAULTS.images;
  const basePort = values.has('--base-port')
    ? readInteger('--base-port', values.get('--base-port')!, 1_024, 65_535)
    : CAPACITY_DEFAULTS.basePort;
  const scenarioValue = values.get('--scenario') ?? CAPACITY_DEFAULTS.scenario;
  if (!CAPACITY_SCENARIOS.includes(scenarioValue as CapacityScenario)) {
    throw new Error(
      `--scenario must be one of ${CAPACITY_SCENARIOS.join('|')} (got "${scenarioValue}")`,
    );
  }
  const scenario = scenarioValue as CapacityScenario;
  const reconnectRatio = values.has('--reconnect-ratio')
    ? readRatio('--reconnect-ratio', values.get('--reconnect-ratio')!)
    : CAPACITY_DEFAULTS.reconnectRatio;
  const timeoutRatio = values.has('--timeout-ratio')
    ? readRatio('--timeout-ratio', values.get('--timeout-ratio')!)
    : CAPACITY_DEFAULTS.timeoutRatio;
  const submitWindowSeconds = values.has('--submit-window-seconds')
    ? readInteger(
        '--submit-window-seconds',
        values.get('--submit-window-seconds')!,
        1,
        3_600,
      )
    : CAPACITY_DEFAULTS.submitWindowSeconds;
  const label = values.get('--label') ?? CAPACITY_DEFAULTS.label;
  if (!/^[A-Za-z0-9._-]{1,60}$/u.test(label)) {
    throw new Error('--label must match [A-Za-z0-9._-]{1,60}');
  }
  const answerIntervalMs = values.has('--answer-interval-ms')
    ? readInteger(
        '--answer-interval-ms',
        values.get('--answer-interval-ms')!,
        0,
        3_600_000,
      )
    : defaultAnswerIntervalMs(minutes, questions);

  return {
    scenario,
    reconnectRatio,
    timeoutRatio,
    submitWindowSeconds,
    users,
    rampSeconds,
    questions,
    minutes,
    audio,
    images,
    answerIntervalMs,
    basePort,
    build,
    keepDatabase,
    label,
  };
}

export type LearnerScenarioInput = {
  scenario: CapacityScenario;
  reconnectRatio: number;
  timeoutRatio: number;
  submitWindowSeconds: number;
  baseUrl: string;
  testId: number;
  learners: readonly LearnerFixture[];
  answerCount: number;
  answerIntervalMs: number;
  rampSeconds: number;
  timeoutMs: number;
  onLearnerDone?: (run: LearnerRun) => void;
};

export type LearnerScenarioResult = {
  samples: LatencySample[];
  learners: LearnerRun[];
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Chạy toàn bộ học viên ảo song song theo offset ramp; trả mẫu + kết quả. */
export async function runLearnerScenario(
  input: LearnerScenarioInput,
): Promise<LearnerScenarioResult> {
  const samples: LatencySample[] = [];
  const client = createExamClient({
    baseUrl: input.baseUrl,
    timeoutMs: input.timeoutMs,
    samples,
  });
  const rampMs = input.rampSeconds * 1_000;
  const offsets = planStartOffsets(input.learners.length, rampMs);
  const reconnectIndices = new Set(
    input.scenario === 'w3'
      ? pickRatioIndices(input.learners.length, input.reconnectRatio)
      : [],
  );
  const timeoutIndices = new Set(
    input.scenario === 'w5'
      ? pickRatioIndices(input.learners.length, input.timeoutRatio)
      : [],
  );
  const submitOffsets =
    input.scenario === 'w4'
      ? planSubmitWaveOffsets(
          input.learners.length,
          input.submitWindowSeconds * 1_000,
        )
      : [];
  // W4: cửa sổ submit bắt đầu sau khi học viên chậm nhất trả lời xong.
  const submitAtEpochMs =
    input.scenario === 'w4'
      ? Date.now() +
        rampMs +
        Math.max(0, input.answerCount - 1) * input.answerIntervalMs +
        2_000
      : undefined;

  const learners = await Promise.all(
    input.learners.map(async (learner, index) => {
      const offset = offsets[index] ?? 0;
      if (offset > 0) await sleep(offset);
      const run = await runLearnerLifecycle({
        client,
        learner,
        testId: input.testId,
        answerCount: input.answerCount,
        answerIntervalMs: input.answerIntervalMs,
        mode:
          input.scenario === 'w7'
            ? 'browse'
            : timeoutIndices.has(index)
              ? 'timeout'
              : 'full',
        reconnect:
          reconnectIndices.has(index) && input.answerCount > 1
            ? { afterAnswers: Math.floor(input.answerCount / 2), batchSize: 20 }
            : undefined,
        submitAtEpochMs,
        submitOffsetMs: submitOffsets[index] ?? 0,
      });
      input.onLearnerDone?.(run);
      return run;
    }),
  );

  return { samples, learners };
}
