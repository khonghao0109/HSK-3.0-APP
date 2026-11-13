import { INVARIANT_NAMES, type CapacityInvariant } from './fixtures';
import type {
  DatabaseMetrics,
  LatencySample,
  RouteSummary,
  ServerRssSummary,
} from './metrics';
import { requiredThresholdCodes } from './scenarios';

/**
 * M4.4 B3a — Ngưỡng dung năng và invariant (P3, P5–P18, RSS, probe429).
 *
 * Module thuần: không I/O, không đụng mạng hay filesystem. Đánh giá trả về
 * mảng kết quả từng mã (PASS, FAIL, hoặc n/a khi không có mẫu quan sát).
 */

export const CAPACITY_THRESHOLDS = {
  P5_READ_P95_MS: 300,
  P6_READ_P99_MS: 800,
  P7_AUTOSAVE_P95_MS: 400,
  P8_AUTOSAVE_P99_MS: 1_000,
  P9_START_P95_MS: 1_500,
  P10_SUBMIT_P95_MS: 1_500,
  P11_RESULT_P95_MS: 2_000,
  P13_LOST_AUTOSAVE: 0,
  P14_DOUBLE_TERMINAL: 0,
  P17_MAX_SERVER_CONNECTIONS: 22,
  RSS_PEAK_MIB: 512,
  P3_MAX_LOCK_WAIT_MS: 1_000,
  P3_MAX_CONSECUTIVE_LOCK_WAIT_SAMPLES: 2,
  P18_RSS_GROWTH_MAX_RATIO: 0.1,
} as const;

export type SoakInput = {
  rssSeries: ServerRssSummary['rssSeries'];
  rampEndMs: number;
  /** `startedAtMs` lớn nhất trong samples: hết tải. */
  lastRequestMs: number;
};

/** Mốc request cuối của P18: `startedAtMs` lớn nhất trong samples. */
export function lastRequestStartedAtMs(
  samples: readonly LatencySample[],
): number | undefined {
  let last: number | undefined;
  for (const sample of samples) {
    if (
      sample.startedAtMs !== undefined &&
      (last === undefined || sample.startedAtMs > last)
    ) {
      last = sample.startedAtMs;
    }
  }
  return last;
}

const P18_MIN_PHASE_MS = 30 * 60_000;
const P18_MIN_RSS_SAMPLES = 60;

/**
 * P18 soak: hồi quy tuyến tính bình phương tối thiểu RSS theo thời gian trên
 * pha ổn định `[rampEndMs, lastRequestMs]`. Tăng trưởng = slope × độ dài pha /
 * giá trị fit tại rampEndMs. Pha < 30 phút hoặc < 60 mẫu RSS → n/a. Một median
 * cửa sổ không đo được rò rỉ vì RSS Node dao động răng cưa GC ±25%.
 */
export function evaluateSoak(input: SoakInput): {
  observed: string;
  verdict: 'PASS' | 'FAIL' | 'n/a';
  growth?: number;
} {
  const phaseMs = input.lastRequestMs - input.rampEndMs;
  const points = input.rssSeries.filter(
    (s) => s.tMs >= input.rampEndMs && s.tMs <= input.lastRequestMs,
  );
  if (phaseMs < P18_MIN_PHASE_MS || points.length < P18_MIN_RSS_SAMPLES) {
    return {
      observed: `n/a (pha ổn định ${(phaseMs / 60_000).toFixed(1)} phút, ${String(points.length)} mẫu RSS)`,
      verdict: 'n/a',
    };
  }
  // Lấy gốc thời gian tại rampEndMs để tránh mất chính xác với epoch ms.
  const n = points.length;
  const meanX =
    points.reduce((sum, s) => sum + (s.tMs - input.rampEndMs), 0) / n;
  const meanY = points.reduce((sum, s) => sum + s.kb, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const s of points) {
    const dx = s.tMs - input.rampEndMs - meanX;
    sxy += dx * (s.kb - meanY);
    sxx += dx * dx;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const startKb = meanY - slope * meanX;
  const endKb = startKb + slope * phaseMs;
  if (!(startKb > 0)) {
    return {
      observed: `n/a (RSS fit đầu không hợp lệ: ${(startKb / 1024).toFixed(1)} MiB)`,
      verdict: 'FAIL',
    };
  }
  const growth = (slope * phaseMs) / startKb;
  const growthPct = growth * 100;
  return {
    observed: `${String(n)} mẫu, pha ${(phaseMs / 60_000).toFixed(1)} phút, RSS fit đầu ${(startKb / 1024).toFixed(1)} MiB, cuối ${(endKb / 1024).toFixed(1)} MiB, tăng ${growthPct >= 0 ? '+' : ''}${growthPct.toFixed(1)}%`,
    verdict:
      growth <= CAPACITY_THRESHOLDS.P18_RSS_GROWTH_MAX_RATIO ? 'PASS' : 'FAIL',
    growth,
  };
}

export type ThresholdEvaluation = {
  code: string;
  criterion: string;
  threshold: string;
  observed: string;
  verdict: 'PASS' | 'FAIL' | 'n/a';
};

export type Probe429Result = {
  autosave200Count: number;
  autosaveFirst429At: number;
  autosaveErrorCode: string | null;
  learner2Errors429: number;
  media200Count: number;
  mediaFirst429At: number;
  ok: boolean;
  detail: string;
};

export type EvaluateThresholdsInput = {
  scenario: string;
  routeSummaries: readonly RouteSummary[];
  database: DatabaseMetrics;
  serverRssKb: ServerRssSummary;
  /**
   * Invariant kèm cờ áp dụng. Thiếu invariant mà mã cần = FAIL; `n/a` chỉ hợp
   * lệ khi invariant có mặt và `applicable === false`.
   */
  invariants: readonly CapacityInvariant[];
  probe429?: Probe429Result | null;
  /** Mốc kết thúc ramp (epoch ms), dùng cho P18 của w8. */
  rampEndMs?: number;
  /** `startedAtMs` lớn nhất trong samples (epoch ms), dùng cho P18 của w8. */
  lastRequestMs?: number;
};

const READ_ROUTES = new Set([
  'GET /exam/tests',
  'GET /exam/tests/:testId',
  'GET /exam/attempts/:id',
  'GET /exam/attempts/:id/result',
  'GET /exam/attempts/:id/media-grants',
]);

const AUTOSAVE_ROUTES = new Set([
  'PUT /exam/attempts/:id/answers/:key',
  'PUT /exam/attempts/:id/answers',
]);

function formatMs(value: number | null): string {
  return value === null ? 'n/a' : `${value.toFixed(1)} ms`;
}

function evaluateMaxPercentile(
  routes: readonly RouteSummary[],
  filter: (route: string) => boolean,
  percentileKey: 'p95Ms' | 'p99Ms',
  limitMs: number,
): { observed: string; verdict: 'PASS' | 'FAIL' | 'n/a' } {
  const matching = routes.filter(
    (entry) =>
      filter(entry.route) && entry.count > 0 && entry[percentileKey] !== null,
  );
  if (matching.length === 0) {
    return { observed: 'n/a (0 mẫu)', verdict: 'n/a' };
  }
  let maxVal = -1;
  let worstRoute = '';
  for (const entry of matching) {
    const val = entry[percentileKey]!;
    if (val > maxVal) {
      maxVal = val;
      worstRoute = entry.route;
    }
  }
  const verdict = maxVal <= limitMs ? 'PASS' : 'FAIL';
  return {
    observed: `${formatMs(maxVal)} (${worstRoute})`,
    verdict,
  };
}

function evaluateSingleRoutePercentile(
  routes: readonly RouteSummary[],
  targetRoute: string,
  percentileKey: 'p95Ms' | 'p99Ms',
  limitMs: number,
): { observed: string; verdict: 'PASS' | 'FAIL' | 'n/a' } {
  const match = routes.find(
    (entry) =>
      entry.route === targetRoute &&
      entry.count > 0 &&
      entry[percentileKey] !== null,
  );
  if (!match || match[percentileKey] === null) {
    return { observed: 'n/a (0 mẫu)', verdict: 'n/a' };
  }
  const val = match[percentileKey];
  return {
    observed: formatMs(val),
    verdict: val <= limitMs ? 'PASS' : 'FAIL',
  };
}

/** Tìm invariant theo đúng tên (===). Không dò chuỗi con trong `name`/`detail`. */
function findInvariant(
  invariants: readonly CapacityInvariant[],
  name: string,
): CapacityInvariant | undefined {
  return invariants.find((invariant) => invariant.name === name);
}

/**
 * Đánh giá một mã dựa trên các invariant bắt buộc:
 * - thiếu bất kỳ invariant nào → FAIL (`thiếu invariant <tên>`), không n/a;
 * - có đủ, tất cả `applicable === false` → n/a (không có gì để đo);
 * - còn lại → PASS khi mọi invariant áp dụng đều ok, ngược lại FAIL.
 */
function evaluateInvariantCode(input: {
  invariants: readonly CapacityInvariant[];
  required: readonly string[];
  notApplicableDetail: (present: readonly CapacityInvariant[]) => string;
}): { observed: string; verdict: 'PASS' | 'FAIL' | 'n/a' } {
  const missing = input.required.filter(
    (name) => findInvariant(input.invariants, name) === undefined,
  );
  if (missing.length > 0) {
    return {
      observed: missing.map((name) => `thiếu invariant ${name}`).join('; '),
      verdict: 'FAIL',
    };
  }
  const present = input.required.map(
    (name) => findInvariant(input.invariants, name)!,
  );
  const applicable = present.filter((invariant) => invariant.applicable);
  if (applicable.length === 0) {
    return {
      observed: input.notApplicableDetail(present),
      verdict: 'n/a',
    };
  }
  const ok = applicable.every((invariant) => invariant.ok);
  return {
    observed: ok
      ? '0'
      : applicable
          .filter((invariant) => !invariant.ok)
          .map((invariant) => invariant.detail)
          .join('; '),
    verdict: ok ? 'PASS' : 'FAIL',
  };
}

export function evaluateThresholds(
  input: EvaluateThresholdsInput,
): ThresholdEvaluation[] {
  const evaluations: ThresholdEvaluation[] = [];

  // P3: lock wait dài (M44-DECISIONS mục 1). Lock wait ngắn vẫn PASS.
  const lockWaits = input.database.lockWaitDetails;
  const p3Ok =
    lockWaits.maxQueryAgeMs < CAPACITY_THRESHOLDS.P3_MAX_LOCK_WAIT_MS &&
    lockWaits.maxConsecutiveSamples <=
      CAPACITY_THRESHOLDS.P3_MAX_CONSECUTIVE_LOCK_WAIT_SAMPLES &&
    lockWaits.unattributedSamples === 0 &&
    // Fail closed: lock wait không rõ thời lượng thì không chứng minh được < 1 s.
    lockWaits.unknownAgeRecords === 0;
  evaluations.push({
    code: 'P3',
    criterion: 'lock wait dài',
    threshold: `< ${String(CAPACITY_THRESHOLDS.P3_MAX_LOCK_WAIT_MS)} ms, ≤ ${String(CAPACITY_THRESHOLDS.P3_MAX_CONSECUTIVE_LOCK_WAIT_SAMPLES)} tick liên tiếp/pid, 0 unattributed, 0 không rõ thời lượng`,
    observed:
      input.database.samples === 0
        ? 'n/a (0 mẫu sampler)'
        : `lock wait ${String(lockWaits.total)}, max ${String(lockWaits.maxQueryAgeMs)} ms, liên tiếp tối đa ${String(lockWaits.maxConsecutiveSamples)} tick, unattributed ${String(lockWaits.unattributedSamples)}, không rõ thời lượng ${String(lockWaits.unknownAgeRecords)}`,
    verdict: input.database.samples === 0 ? 'n/a' : p3Ok ? 'PASS' : 'FAIL',
  });

  // P5: p95 đọc ≤ 300 ms
  const p5 = evaluateMaxPercentile(
    input.routeSummaries,
    (route) => READ_ROUTES.has(route),
    'p95Ms',
    CAPACITY_THRESHOLDS.P5_READ_P95_MS,
  );
  evaluations.push({
    code: 'P5',
    criterion: 'p95 đọc',
    threshold: `≤ ${String(CAPACITY_THRESHOLDS.P5_READ_P95_MS)} ms`,
    observed: p5.observed,
    verdict: p5.verdict,
  });

  // P6: p99 đọc ≤ 800 ms
  const p6 = evaluateMaxPercentile(
    input.routeSummaries,
    (route) => READ_ROUTES.has(route),
    'p99Ms',
    CAPACITY_THRESHOLDS.P6_READ_P99_MS,
  );
  evaluations.push({
    code: 'P6',
    criterion: 'p99 đọc',
    threshold: `≤ ${String(CAPACITY_THRESHOLDS.P6_READ_P99_MS)} ms`,
    observed: p6.observed,
    verdict: p6.verdict,
  });

  // P7: p95 autosave ≤ 400 ms
  const p7 = evaluateMaxPercentile(
    input.routeSummaries,
    (route) => AUTOSAVE_ROUTES.has(route),
    'p95Ms',
    CAPACITY_THRESHOLDS.P7_AUTOSAVE_P95_MS,
  );
  evaluations.push({
    code: 'P7',
    criterion: 'p95 autosave',
    threshold: `≤ ${String(CAPACITY_THRESHOLDS.P7_AUTOSAVE_P95_MS)} ms`,
    observed: p7.observed,
    verdict: p7.verdict,
  });

  // P8: p99 autosave ≤ 1000 ms
  const p8 = evaluateMaxPercentile(
    input.routeSummaries,
    (route) => AUTOSAVE_ROUTES.has(route),
    'p99Ms',
    CAPACITY_THRESHOLDS.P8_AUTOSAVE_P99_MS,
  );
  evaluations.push({
    code: 'P8',
    criterion: 'p99 autosave',
    threshold: `≤ ${String(CAPACITY_THRESHOLDS.P8_AUTOSAVE_P99_MS)} ms`,
    observed: p8.observed,
    verdict: p8.verdict,
  });

  // P9: p95 start ≤ 1500 ms
  const p9 = evaluateSingleRoutePercentile(
    input.routeSummaries,
    'POST /exam/tests/:testId/attempts',
    'p95Ms',
    CAPACITY_THRESHOLDS.P9_START_P95_MS,
  );
  evaluations.push({
    code: 'P9',
    criterion: 'p95 start',
    threshold: `≤ ${String(CAPACITY_THRESHOLDS.P9_START_P95_MS)} ms`,
    observed: p9.observed,
    verdict: p9.verdict,
  });

  // P10: p95 submit ≤ 1500 ms
  const p10 = evaluateSingleRoutePercentile(
    input.routeSummaries,
    'POST /exam/attempts/:id/submit',
    'p95Ms',
    CAPACITY_THRESHOLDS.P10_SUBMIT_P95_MS,
  );
  evaluations.push({
    code: 'P10',
    criterion: 'p95 submit',
    threshold: `≤ ${String(CAPACITY_THRESHOLDS.P10_SUBMIT_P95_MS)} ms`,
    observed: p10.observed,
    verdict: p10.verdict,
  });

  // P11: p95 result lần đầu ≤ 2000 ms
  const p11 = evaluateSingleRoutePercentile(
    input.routeSummaries,
    'GET /exam/attempts/:id/result',
    'p95Ms',
    CAPACITY_THRESHOLDS.P11_RESULT_P95_MS,
  );
  evaluations.push({
    code: 'P11',
    criterion: 'p95 result lần đầu',
    threshold: `≤ ${String(CAPACITY_THRESHOLDS.P11_RESULT_P95_MS)} ms`,
    observed: p11.observed,
    verdict: p11.verdict,
  });

  // P13: mất autosave = 0
  const p13 = evaluateInvariantCode({
    invariants: input.invariants,
    required: [INVARIANT_NAMES.ANSWER_COUNT],
    notApplicableDetail: (present) => present[0]?.detail ?? 'n/a',
  });
  evaluations.push({
    code: 'P13',
    criterion: 'mất autosave',
    threshold: '= 0',
    observed: p13.observed,
    verdict: p13.verdict,
  });

  // P14: double terminal/Result = 0
  const p14 = evaluateInvariantCode({
    invariants: input.invariants,
    required: [
      INVARIANT_NAMES.SINGLE_RESULT,
      INVARIANT_NAMES.SINGLE_IN_PROGRESS,
    ],
    notApplicableDetail: (present) =>
      present.map((invariant) => invariant.detail).join('; '),
  });
  evaluations.push({
    code: 'P14',
    criterion: 'double terminal/Result',
    threshold: '= 0',
    observed: p14.observed,
    verdict: p14.verdict,
  });

  // P17: pool — chỉ còn connection server ≤ 22 (lock wait chuyển sang P3).
  evaluations.push({
    code: 'P17',
    criterion: 'connection server (pool)',
    threshold: `conn ≤ ${String(CAPACITY_THRESHOLDS.P17_MAX_SERVER_CONNECTIONS)}`,
    observed: `conn ${String(input.database.maxConnections)}`,
    verdict:
      input.database.maxConnections <=
      CAPACITY_THRESHOLDS.P17_MAX_SERVER_CONNECTIONS
        ? 'PASS'
        : 'FAIL',
  });

  // P18: soak, chỉ có hàng ở w8 (scenario khác không hiện P18).
  if (input.scenario === 'w8') {
    const { rampEndMs, lastRequestMs } = input;
    let p18: { observed: string; verdict: 'PASS' | 'FAIL' | 'n/a' };
    if (rampEndMs === undefined || lastRequestMs === undefined) {
      p18 = {
        observed: 'n/a (thiếu mốc ramp hoặc request cuối)',
        verdict: 'n/a',
      };
    } else {
      p18 = evaluateSoak({
        rssSeries: input.serverRssKb.rssSeries,
        rampEndMs,
        lastRequestMs,
      });
      if (p18.verdict !== 'n/a') {
        // Connection không vào verdict (trần do P17 kiểm), chỉ để tham khảo.
        const phaseConn = input.database.connectionSeries
          .filter((s) => s.tMs >= rampEndMs && s.tMs <= lastRequestMs)
          .map((s) => s.serverConnections);
        const maxConn =
          phaseConn.length === 0 ? 'n/a' : String(Math.max(...phaseConn));
        p18 = {
          ...p18,
          observed: `${p18.observed}, conn max pha ${maxConn} (tham khảo)`,
        };
      }
    }
    evaluations.push({
      code: 'P18',
      criterion: 'soak RSS (hồi quy pha ổn định)',
      threshold: `RSS tăng ≤ ${String(CAPACITY_THRESHOLDS.P18_RSS_GROWTH_MAX_RATIO * 100)}% trên pha [hết ramp, request cuối], ≥ 30 phút và ≥ 60 mẫu`,
      observed: p18.observed,
      verdict: p18.verdict,
    });
  }

  // RSS: RSS server đỉnh ≤ 512 MiB
  const peakKb = input.serverRssKb.peakKb;
  let rssVerdict: 'PASS' | 'FAIL' | 'n/a' = 'n/a';
  let rssObserved = 'n/a';
  if (peakKb !== null) {
    const peakMib = peakKb / 1024;
    rssVerdict = peakMib <= CAPACITY_THRESHOLDS.RSS_PEAK_MIB ? 'PASS' : 'FAIL';
    rssObserved = `${peakMib.toFixed(1)} MiB`;
  }
  evaluations.push({
    code: 'RSS',
    criterion: 'RSS server đỉnh',
    threshold: `≤ ${String(CAPACITY_THRESHOLDS.RSS_PEAK_MIB)} MiB`,
    observed: rssObserved,
    verdict: rssVerdict,
  });

  // P15: probe429 (chỉ áp dụng cho scenario probe429)
  if (input.scenario === 'probe429') {
    const probe = input.probe429;
    if (probe) {
      evaluations.push({
        code: 'P15',
        criterion: 'probe 429 biên',
        threshold:
          'biên 240/phút/user & 600/phút/IP, envelope đúng, 0 lan user',
        observed: probe.detail,
        verdict: probe.ok ? 'PASS' : 'FAIL',
      });
    } else {
      evaluations.push({
        code: 'P15',
        criterion: 'probe 429 biên',
        threshold:
          'biên 240/phút/user & 600/phút/IP, envelope đúng, 0 lan user',
        observed: 'thiếu kết quả probe',
        verdict: 'FAIL',
      });
    }
  } else {
    evaluations.push({
      code: 'P15',
      criterion: 'probe 429 biên',
      threshold: 'biên 240/phút/user & 600/phút/IP, envelope đúng, 0 lan user',
      observed: 'n/a (chỉ chạy ở scenario probe429)',
      verdict: 'n/a',
    });
  }

  // F3 — mã bắt buộc của scenario không được n/a. Danh sách bắt buộc suy từ
  // đúng các route mà scenario gọi (`REQUIRED_THRESHOLD_CODES`), nên n/a ở đây
  // nghĩa là thiếu mẫu đo thật, không phải trường hợp miễn đo.
  const required = requiredThresholdCodes(input.scenario);
  for (let index = 0; index < evaluations.length; index += 1) {
    const evaluation = evaluations[index];
    if (evaluation.verdict === 'n/a' && required.includes(evaluation.code)) {
      evaluations[index] = {
        ...evaluation,
        observed: 'bắt buộc nhưng 0 mẫu',
        verdict: 'FAIL',
      };
    }
  }

  return evaluations;
}

export function isThresholdsPassing(
  evaluations: readonly ThresholdEvaluation[],
): boolean {
  return evaluations.every((evaluation) => evaluation.verdict !== 'FAIL');
}

export function renderThresholdsMarkdownTable(
  evaluations: readonly ThresholdEvaluation[],
): string {
  const lines: string[] = [
    '## Ngưỡng dung năng (P3, P5–P18, RSS)',
    '',
    '| Mã | Tiêu chí | Ngưỡng | Giá trị quan sát | Kết quả |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const item of evaluations) {
    lines.push(
      `| ${item.code} | ${item.criterion} | ${item.threshold} | ${item.observed} | ${item.verdict} |`,
    );
  }
  return lines.join('\n');
}
