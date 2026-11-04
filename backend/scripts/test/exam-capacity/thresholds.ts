import type {
  DatabaseMetrics,
  InvariantResult,
  RouteSummary,
  ServerRssSummary,
} from './metrics';

/**
 * M4.4 B3a — Ngưỡng dung năng và invariant (P5–P17, RSS, probe429).
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
  P17_MAX_LOCK_WAITS: 0,
  RSS_PEAK_MIB: 512,
} as const;

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
  invariants: readonly InvariantResult[];
  probe429?: Probe429Result | null;
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

export function evaluateThresholds(
  input: EvaluateThresholdsInput,
): ThresholdEvaluation[] {
  const evaluations: ThresholdEvaluation[] = [];

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
  const lostInvariant = input.invariants.find((inv) =>
    inv.name.includes('PUT 200 duy nhất'),
  );
  let p13Verdict: 'PASS' | 'FAIL' | 'n/a' = 'n/a';
  let p13Observed = 'n/a';
  if (lostInvariant) {
    if (lostInvariant.detail.includes('không áp dụng')) {
      p13Verdict = 'n/a';
      p13Observed = lostInvariant.detail;
    } else {
      p13Verdict = lostInvariant.ok ? 'PASS' : 'FAIL';
      p13Observed = lostInvariant.ok ? '0' : lostInvariant.detail;
    }
  }
  evaluations.push({
    code: 'P13',
    criterion: 'mất autosave',
    threshold: '= 0',
    observed: p13Observed,
    verdict: p13Verdict,
  });

  // P14: double terminal/Result = 0
  const doubleResultInv = input.invariants.find((inv) =>
    inv.name.includes('đúng 1 Result'),
  );
  const doubleAttemptInv = input.invariants.find((inv) =>
    inv.name.includes('≤1 attempt in_progress'),
  );
  let p14Verdict: 'PASS' | 'FAIL' | 'n/a' = 'n/a';
  let p14Observed = 'n/a';
  if (doubleResultInv && doubleAttemptInv) {
    const ok = doubleResultInv.ok && doubleAttemptInv.ok;
    p14Verdict = ok ? 'PASS' : 'FAIL';
    p14Observed = ok
      ? '0'
      : `${doubleResultInv.detail}; ${doubleAttemptInv.detail}`;
  }
  evaluations.push({
    code: 'P14',
    criterion: 'double terminal/Result',
    threshold: '= 0',
    observed: p14Observed,
    verdict: p14Verdict,
  });

  // P17: connection server ≤ 22 và lock wait = 0
  const connOk =
    input.database.maxConnections <=
    CAPACITY_THRESHOLDS.P17_MAX_SERVER_CONNECTIONS;
  const lockWaitOk =
    input.database.maxLockWaits <= CAPACITY_THRESHOLDS.P17_MAX_LOCK_WAITS;
  const p17Verdict = connOk && lockWaitOk ? 'PASS' : 'FAIL';
  evaluations.push({
    code: 'P17',
    criterion: 'connection server & lock wait',
    threshold: `conn ≤ ${String(CAPACITY_THRESHOLDS.P17_MAX_SERVER_CONNECTIONS)}, lock wait = ${String(CAPACITY_THRESHOLDS.P17_MAX_LOCK_WAITS)}`,
    observed: `conn ${String(input.database.maxConnections)}, lock wait ${String(input.database.maxLockWaits)}`,
    verdict: p17Verdict,
  });

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
    '## Ngưỡng dung năng (P5–P17, RSS)',
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
