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

export type CapacityArgs = {
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
  const offsets = planStartOffsets(
    input.learners.length,
    input.rampSeconds * 1_000,
  );

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
      });
      input.onLearnerDone?.(run);
      return run;
    }),
  );

  return { samples, learners };
}
