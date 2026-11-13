import { randomUUID } from 'node:crypto';

import {
  asRecord,
  CAPACITY_ROUTES,
  createExamClient,
  extractQuestionKeys,
  runLearnerLifecycle,
  type ExamClient,
  type LearnerFixture,
  type LearnerRun,
} from './driver';
import type { LatencySample } from './metrics';
import { DEFAULT_PRELOAD_GAP_MS } from './preload-planner';
import type { Probe429Result } from './thresholds';

/**
 * M4.4 B1 — cấu hình kịch bản và bộ chạy học viên ảo.
 *
 * Phần thuần (offset ramp, nhịp answer mặc định, parse CLI) được unit test bằng
 * `node --test`; phần IO chỉ gọi driver HTTP và không tự đánh giá ngưỡng.
 */

export type CapacityScenario =
  | 'w1'
  | 'w3'
  | 'w4'
  | 'w5'
  | 'w7'
  | 'w6'
  | 'w45'
  | 'w8'
  | 'probe429';

export const CAPACITY_SCENARIOS: readonly CapacityScenario[] = [
  'w1',
  'w3',
  'w4',
  'w5',
  'w7',
  'w6',
  'w45',
  'w8',
  'probe429',
];

/**
 * Mã ngưỡng bắt buộc phải có mẫu đo, suy từ đúng những route mà scenario gọi
 * (xem `runLearnerLifecycle` + `runProbe429`):
 *
 * - `w1`, `w3`, `w4`, `w6`, `w45`: vòng đời đầy đủ list → intro → start →
 *   attempt → save → submit → result, nên P5/P6 (đọc), P7/P8 (autosave),
 *   P9 (start), P10 (submit), P11 (result), P13/P14 (invariant DB), P17, RSS
 *   đều phải có mẫu.
 * - `w5`: trả lời hết nhưng KHÔNG submit (mode timeout), nên P10 không có mẫu
 *   và không bắt buộc; P11 có (GET result sau khi hết giờ).
 * - `w7`: chỉ list + intro, không tạo attempt, nên chỉ P5/P6/P17/RSS bắt buộc.
 * - `probe429`: start + GET attempt + PUT save + media, không submit/result,
 *   nên P5/P6/P7/P8/P9/P14/P17/RSS bắt buộc; P15 do chính scenario này sinh
 *   ra và được đánh giá riêng. probe429 cố ý gửi PUT vượt 240/phút để nhận
 *   429, nên không có kỳ vọng "số ExamAnswer = số PUT 200"; việc kiểm mất
 *   autosave nằm ở các scenario có vòng đời đầy đủ. Vì vậy P13 không nằm trong
 *   danh sách bắt buộc của probe429.
 * - `w8` (soak): hành xử y hệt w1 (không nhánh riêng), thêm P18 so cửa sổ
 *   10 phút sau ramp với 10 phút cuối.
 * - P3 (lock wait dài) bắt buộc ở mọi scenario vì sampler chạy ở mọi run.
 */
const FULL_LIFECYCLE_CODES: readonly string[] = [
  'P3',
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
];

export const REQUIRED_THRESHOLD_CODES: Record<
  CapacityScenario,
  readonly string[]
> = {
  w1: FULL_LIFECYCLE_CODES,
  w3: FULL_LIFECYCLE_CODES,
  w4: FULL_LIFECYCLE_CODES,
  w5: ['P3', 'P5', 'P6', 'P7', 'P8', 'P9', 'P11', 'P13', 'P14', 'P17', 'RSS'],
  w7: ['P3', 'P5', 'P6', 'P17', 'RSS'],
  w6: FULL_LIFECYCLE_CODES,
  w45: FULL_LIFECYCLE_CODES,
  w8: [...FULL_LIFECYCLE_CODES, 'P18'],
  probe429: ['P3', 'P5', 'P6', 'P7', 'P8', 'P9', 'P14', 'P15', 'P17', 'RSS'],
};

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

/**
 * Mã bắt buộc của một scenario. Scenario lạ phải ném lỗi: trả rỗng sẽ làm
 * bước F3 trong `evaluateThresholds` thành no-op (fail-open).
 */
export function requiredThresholdCodes(scenario: string): readonly string[] {
  if (!CAPACITY_SCENARIOS.includes(scenario as CapacityScenario)) {
    throw new Error(`unknown capacity scenario: ${scenario}`);
  }
  return REQUIRED_THRESHOLD_CODES[scenario as CapacityScenario];
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
  minutes?: number;
  timeoutMs: number;
  mediaSha256?: Map<number, string>;
  onLearnerDone?: (run: LearnerRun) => void;
};

export type LearnerScenarioResult = {
  samples: LatencySample[];
  learners: LearnerRun[];
  probe429?: Probe429Result;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function runProbe429(
  input: LearnerScenarioInput,
  client: ExamClient,
  samples: LatencySample[],
): Promise<LearnerScenarioResult> {
  const learner1 = input.learners[0];
  const learner2 = input.learners[1];
  if (!learner1 || !learner2) {
    throw new Error('scenario probe429 requires at least 2 learners');
  }

  // 1. Cả hai learner start attempt
  const started1 = await client.post(
    CAPACITY_ROUTES.start,
    `/exam/tests/${String(input.testId)}/attempts`,
    learner1.accessToken,
    { idempotencyKey: randomUUID() },
  );
  const startedData1 = asRecord(asRecord(started1.payload)?.['data']);
  const attemptId1 =
    typeof startedData1?.['id'] === 'number' ? startedData1['id'] : 0;

  const started2 = await client.post(
    CAPACITY_ROUTES.start,
    `/exam/tests/${String(input.testId)}/attempts`,
    learner2.accessToken,
    { idempotencyKey: randomUUID() },
  );
  const startedData2 = asRecord(asRecord(started2.payload)?.['data']);
  const attemptId2 =
    typeof startedData2?.['id'] === 'number' ? startedData2['id'] : 0;

  // Lấy question key của mỗi attempt
  const attemptView1 = await client.get(
    CAPACITY_ROUTES.attempt,
    `/exam/attempts/${String(attemptId1)}`,
    learner1.accessToken,
  );
  const keys1 = extractQuestionKeys(asRecord(attemptView1.payload)?.['data']);
  const questionKey1 = keys1[0] ?? 'q1';

  const attemptView2 = await client.get(
    CAPACITY_ROUTES.attempt,
    `/exam/attempts/${String(attemptId2)}`,
    learner2.accessToken,
  );
  const keys2 = extractQuestionKeys(asRecord(attemptView2.payload)?.['data']);
  const questionKey2 = keys2[0] ?? 'q1';

  // Probe (a): PUT answer vượt 240/phút/user
  let autosave200Count = 0;
  let autosaveFirst429At = 0;
  let autosaveErrorCode: string | null = null;
  let currentVersion1: number | null = null;

  for (let i = 1; i <= 245; i += 1) {
    const res = await client.put(
      CAPACITY_ROUTES.save,
      `/exam/attempts/${String(attemptId1)}/answers/${questionKey1}`,
      learner1.accessToken,
      {
        answer: { choice: 'a' },
        isFlagged: false,
        expectedVersion: currentVersion1,
        idempotencyKey: randomUUID(),
      },
    );
    if (res.status === 200) {
      if (autosaveFirst429At === 0) autosave200Count += 1;
      const data = asRecord(asRecord(res.payload)?.['data']);
      if (typeof data?.['version'] === 'number') {
        currentVersion1 = data['version'];
      }
    } else if (res.status === 429 && autosaveFirst429At === 0) {
      autosaveFirst429At = i;
      autosaveErrorCode = res.code;
    }
  }

  // Learner 2 gửi 5 PUT answer: bảo đảm 0 lỗi 429
  let learner2Errors429 = 0;
  let currentVersion2: number | null = null;
  for (let i = 1; i <= 5; i += 1) {
    const res = await client.put(
      CAPACITY_ROUTES.save,
      `/exam/attempts/${String(attemptId2)}/answers/${questionKey2}`,
      learner2.accessToken,
      {
        answer: { choice: 'a' },
        isFlagged: false,
        expectedVersion: currentVersion2,
        idempotencyKey: randomUUID(),
      },
    );
    if (res.status === 200) {
      const data = asRecord(asRecord(res.payload)?.['data']);
      if (typeof data?.['version'] === 'number') {
        currentVersion2 = data['version'];
      }
    } else if (res.status === 429) {
      learner2Errors429 += 1;
    }
  }

  // Probe (b): Media content per IP vượt 600/phút
  const grantsRes = await client.get(
    CAPACITY_ROUTES.mediaGrants,
    `/exam/attempts/${String(attemptId1)}/media-grants`,
    learner1.accessToken,
  );
  const grantsData = asRecord(asRecord(grantsRes.payload)?.['data']);
  const grants = Array.isArray(grantsData?.['grants'])
    ? (grantsData['grants'] as Array<{ url: string }>)
    : [];

  let media200Count = 0;
  let mediaFirst429At = 0;

  if (grants.length > 0) {
    for (let i = 1; i <= 610; i += 1) {
      const targetGrant = grants[(i - 1) % grants.length];
      if (!targetGrant) break;
      const res = await client.getMedia(
        CAPACITY_ROUTES.mediaContent,
        targetGrant.url,
        learner1.accessToken,
      );
      if (res.status === 200 && mediaFirst429At === 0) {
        media200Count += 1;
      } else if (res.status === 429 && mediaFirst429At === 0) {
        mediaFirst429At = i;
      }
    }
  }

  const aOk =
    autosave200Count >= 239 &&
    autosave200Count <= 241 &&
    autosaveErrorCode === 'TOO_MANY_REQUESTS' &&
    learner2Errors429 === 0;

  const bOk = media200Count >= 599 && media200Count <= 601;

  const ok = aOk && bOk;
  const detail = `(a) ${String(autosave200Count)} ok trước 429 (req ${String(autosaveFirst429At)}), code ${autosaveErrorCode ?? 'none'}, user 2: ${String(learner2Errors429)} 429; (b) ${String(media200Count)} ok trước 429 (req ${String(mediaFirst429At)})`;

  const probe429: Probe429Result = {
    autosave200Count,
    autosaveFirst429At,
    autosaveErrorCode,
    learner2Errors429,
    media200Count,
    mediaFirst429At,
    ok,
    detail,
  };

  const learners: LearnerRun[] = [
    {
      index: learner1.index,
      userId: learner1.userId,
      attemptId: attemptId1,
      mode: 'full',
      requestedAnswerCount: 0,
      savedQuestionKeys: [],
      completed: true,
      failures: [],
    },
    {
      index: learner2.index,
      userId: learner2.userId,
      attemptId: attemptId2,
      mode: 'full',
      requestedAnswerCount: 0,
      savedQuestionKeys: [],
      completed: true,
      failures: [],
    },
  ];

  return { samples, learners, probe429 };
}

export type LearnerPlan = {
  offsetMs: number;
  mode: 'browse' | 'timeout' | 'full';
  isTimeout: boolean;
  preloadAudio: boolean;
  reconnect: { afterAnswers: number; batchSize: number } | undefined;
  submitOffsetMs: number;
};

/**
 * Kế hoạch thuần cho từng học viên (offset, mode, reconnect, timeout, submit
 * wave). w8 không có nhánh riêng nên kế hoạch trùng w1 khi cùng cấu hình.
 */
export function planLearnerScenario(input: {
  scenario: CapacityScenario;
  learnerCount: number;
  rampSeconds: number;
  answerCount: number;
  reconnectRatio: number;
  timeoutRatio: number;
  submitWindowSeconds: number;
}): { isSubmitWave: boolean; learners: LearnerPlan[] } {
  const offsets = planStartOffsets(
    input.learnerCount,
    input.rampSeconds * 1_000,
  );
  const reconnectIndices = new Set(
    input.scenario === 'w3'
      ? pickRatioIndices(input.learnerCount, input.reconnectRatio)
      : [],
  );
  const timeoutIndices = new Set(
    input.scenario === 'w5' || input.scenario === 'w45'
      ? pickRatioIndices(input.learnerCount, input.timeoutRatio)
      : [],
  );
  const isSubmitWave = input.scenario === 'w4' || input.scenario === 'w45';
  const submitOffsets = isSubmitWave
    ? planSubmitWaveOffsets(
        input.learnerCount - timeoutIndices.size,
        input.submitWindowSeconds * 1_000,
      )
    : [];
  let submitOffsetIndex = 0;
  const learners: LearnerPlan[] = [];
  for (let index = 0; index < input.learnerCount; index += 1) {
    const isTimeout = timeoutIndices.has(index);
    learners.push({
      offsetMs: offsets[index] ?? 0,
      mode: input.scenario === 'w7' ? 'browse' : isTimeout ? 'timeout' : 'full',
      isTimeout,
      preloadAudio: input.scenario === 'w6',
      reconnect:
        reconnectIndices.has(index) && input.answerCount > 1
          ? { afterAnswers: Math.floor(input.answerCount / 2), batchSize: 20 }
          : undefined,
      submitOffsetMs:
        !isTimeout && isSubmitWave
          ? (submitOffsets[submitOffsetIndex++] ?? 0)
          : 0,
    });
  }
  return { isSubmitWave, learners };
}

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

  if (input.scenario === 'probe429') {
    return runProbe429(input, client, samples);
  }

  const rampMs = input.rampSeconds * 1_000;
  const plan = planLearnerScenario({
    scenario: input.scenario,
    learnerCount: input.learners.length,
    rampSeconds: input.rampSeconds,
    answerCount: input.answerCount,
    reconnectRatio: input.reconnectRatio,
    timeoutRatio: input.timeoutRatio,
    submitWindowSeconds: input.submitWindowSeconds,
  });
  const isSubmitWave = plan.isSubmitWave;

  // Cửa sổ submit bắt đầu sau khi học viên chậm nhất trả lời xong.
  let submitAtEpochMs = isSubmitWave
    ? Date.now() +
      rampMs +
      Math.max(0, input.answerCount - 1) * input.answerIntervalMs +
      2_000
    : undefined;

  // Nếu đề ngắn hoặc cấu hình ramp/interval dài, co submit window để
  // toàn bộ submit hoàn tất trước khi attempt hết giờ (an toàn biên 10s).
  if (
    submitAtEpochMs !== undefined &&
    isSubmitWave &&
    typeof input.minutes === 'number' &&
    input.minutes > 0
  ) {
    const testDurationMs = input.minutes * 60_000;
    const maxSafeSubmitEnd = Date.now() + testDurationMs - 10_000;
    const submitEnd = submitAtEpochMs + input.submitWindowSeconds * 1_000;
    if (submitEnd > maxSafeSubmitEnd) {
      submitAtEpochMs = Math.max(
        Date.now(),
        maxSafeSubmitEnd - input.submitWindowSeconds * 1_000,
      );
    }
  }

  const learners = await Promise.all(
    input.learners.map(async (learner, index) => {
      const learnerPlan = plan.learners[index];
      if (learnerPlan.offsetMs > 0) await sleep(learnerPlan.offsetMs);

      const run = await runLearnerLifecycle({
        client,
        learner,
        testId: input.testId,
        answerCount: input.answerCount,
        answerIntervalMs: input.answerIntervalMs,
        mode: learnerPlan.mode,
        preloadAudio: learnerPlan.preloadAudio
          ? {
              gapMs: DEFAULT_PRELOAD_GAP_MS,
              expectedSha256: input.mediaSha256,
            }
          : undefined,
        reconnect: learnerPlan.reconnect,
        submitAtEpochMs: learnerPlan.isTimeout ? undefined : submitAtEpochMs,
        submitOffsetMs: learnerPlan.submitOffsetMs,
      });
      input.onLearnerDone?.(run);
      return run;
    }),
  );

  return { samples, learners };
}
