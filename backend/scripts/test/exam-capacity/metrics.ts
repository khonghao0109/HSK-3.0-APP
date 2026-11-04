/**
 * M4.4 B1 — phép đo thuần cho harness capacity luồng thi.
 *
 * Module không chạm mạng, DB hay filesystem: mọi hàm nhận mẫu đã đo và trả về
 * cấu trúc thuần để unit test điều khiển được (percentile biên, route trùng,
 * status lỗi). Runner `run-exam-capacity.ts` là nơi duy nhất ghi artifact.
 */

export type LatencySample = {
  /** Nhãn route đã chuẩn hoá, ví dụ `PUT /exam/attempts/:id/answers/:key`. */
  route: string;
  method: string;
  path: string;
  status: number;
  /** `error.code` của envelope khi có, null khi thành công. */
  code: string | null;
  durationMs: number;
  /** Epoch ms lúc bắt đầu request; chỉ dùng cho cửa sổ submit (W4). */
  startedAtMs?: number;
};

export type RouteSummary = {
  route: string;
  count: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
  statusCounts: Record<string, number>;
  errorCodes: Record<string, number>;
  serverErrors: number;
  rateLimited: number;
};

export type ServerRssSummary = {
  firstKb: number | null;
  lastKb: number | null;
  peakKb: number | null;
};

export type DatabaseMetrics = {
  deadlocksBefore: number;
  deadlocksAfter: number;
  /** Connection của server (application_name riêng), không tính runner/sampler. */
  maxConnections: number;
  /** Tổng connection tới database để tham chiếu. */
  maxTotalConnections: number;
  maxLockWaits: number;
  samples: number;
  /** Số lần sampler pg_stat_activity lỗi — phải là 0 để số đo đáng tin. */
  samplerErrors: number;
};

export type InvariantResult = {
  name: string;
  ok: boolean;
  detail: string;
};

export type CapacityRunConfig = {
  scenario: string;
  reconnectRatio: number;
  timeoutRatio: number;
  submitWindowSeconds: number;
  connectionLimit: string;
  users: number;
  rampSeconds: number;
  questions: number;
  minutes: number;
  answerIntervalMs: number;
  audioPerTest: number;
  imagesPerTest: number;
};

export type CapacitySummaryInput = {
  label: string;
  startedAt: string;
  finishedAt: string;
  nodeVersion: string;
  serverPid: number;
  serverEnvironment: string;
  baseUrl: string;
  config: CapacityRunConfig;
  effectiveLimits: readonly string[];
  loadAverageStart: string;
  loadAverageEnd: string;
  routeSummaries: readonly RouteSummary[];
  serverRssKb: ServerRssSummary;
  database: DatabaseMetrics;
  invariants: readonly InvariantResult[];
  totalRequests: number;
};

/**
 * Percentile nearest-rank trên mẫu thô: sắp xếp tăng dần rồi lấy
 * `ceil(p/100 * n) - 1`. Không nội suy để p95 của một mẫu luôn là chính mẫu đó.
 */
export function percentile(
  values: readonly number[],
  requested: number,
): number | null {
  if (!Number.isFinite(requested) || requested <= 0 || requested > 100) {
    throw new RangeError('percentile must be in (0, 100]');
  }
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil((requested / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] ?? null;
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

/** Gộp mẫu theo route; route sắp xếp theo alphabet để artifact ổn định. */
export function summarizeSamples(
  samples: readonly LatencySample[],
): RouteSummary[] {
  const byRoute = new Map<string, LatencySample[]>();
  for (const sample of samples) {
    const bucket = byRoute.get(sample.route);
    if (bucket === undefined) byRoute.set(sample.route, [sample]);
    else bucket.push(sample);
  }

  return [...byRoute.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([route, bucket]) => {
      const durations = bucket.map((sample) => sample.durationMs);
      const codes = bucket
        .map((sample) => sample.code)
        .filter((code): code is string => code !== null);
      return {
        route,
        count: bucket.length,
        p50Ms: percentile(durations, 50),
        p95Ms: percentile(durations, 95),
        p99Ms: percentile(durations, 99),
        maxMs: durations.length === 0 ? null : Math.max(...durations),
        statusCounts: countBy(bucket.map((sample) => String(sample.status))),
        errorCodes: countBy(codes),
        serverErrors: bucket.filter((sample) => sample.status >= 500).length,
        rateLimited: bucket.filter((sample) => sample.status === 429).length,
      };
    });
}

function formatMs(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)} ms`;
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (entries.length === 0) return '—';
  return entries.map(([key, value]) => `${key}×${String(value)}`).join(', ');
}

function formatKb(value: number | null): string {
  return value === null ? '—' : `${(value / 1024).toFixed(1)} MiB`;
}

/**
 * Render `summary.md`. Chỉ in số đã đo; không tự kết luận PASS/FAIL theo ngưỡng
 * P1–P19 (B1 không áp ngưỡng — chờ PO). Kết luận duy nhất là invariant đúng/sai.
 */
export function renderSummaryMarkdown(input: CapacitySummaryInput): string {
  const failedInvariants = input.invariants.filter((item) => !item.ok);
  const invariantVerdict = failedInvariants.length === 0 ? 'PASS' : 'FAIL';
  const deadlockDelta =
    input.database.deadlocksAfter - input.database.deadlocksBefore;

  const lines: string[] = [
    `# Capacity run ${input.label}`,
    '',
    `- Bắt đầu: ${input.startedAt}`,
    `- Kết thúc: ${input.finishedAt}`,
    `- Node: ${input.nodeVersion}`,
    `- Server: pid ${String(input.serverPid)}, NODE_ENV=${input.serverEnvironment}`,
    `- Base URL: ${input.baseUrl}`,
    `- Tổng request: ${String(input.totalRequests)}`,
    `- Load average đầu: ${input.loadAverageStart}`,
    `- Load average cuối: ${input.loadAverageEnd}`,
    '',
    '## Cấu hình workload',
    '',
    '| Tham số | Giá trị |',
    '| --- | --- |',
    `| scenario | ${input.config.scenario} |`,
    `| users | ${String(input.config.users)} |`,
    `| rampSeconds | ${String(input.config.rampSeconds)} |`,
    `| questions | ${String(input.config.questions)} |`,
    `| minutes | ${String(input.config.minutes)} |`,
    `| answerIntervalMs | ${String(input.config.answerIntervalMs)} |`,
    `| audioPerTest | ${String(input.config.audioPerTest)} |`,
    `| imagesPerTest | ${String(input.config.imagesPerTest)} |`,
    `| reconnectRatio | ${String(input.config.reconnectRatio)} |`,
    `| timeoutRatio | ${String(input.config.timeoutRatio)} |`,
    `| submitWindowSeconds | ${String(input.config.submitWindowSeconds)} |`,
    `| connection_limit (server) | ${input.config.connectionLimit} |`,
    '',
    '## Trần rate limit hiệu lực',
    '',
    ...input.effectiveLimits.map((limit) => `- ${limit}`),
    '',
    '## Độ trễ theo route',
    '',
    '| Route | n | p50 | p95 | p99 | max | status | mã lỗi | 5xx | 429 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...input.routeSummaries.map(
      (route) =>
        `| ${route.route} | ${String(route.count)} | ${formatMs(route.p50Ms)} | ${formatMs(route.p95Ms)} | ${formatMs(route.p99Ms)} | ${formatMs(route.maxMs)} | ${formatCounts(route.statusCounts)} | ${formatCounts(route.errorCodes)} | ${String(route.serverErrors)} | ${String(route.rateLimited)} |`,
    ),
    '',
    '## Server',
    '',
    `- RSS đầu: ${formatKb(input.serverRssKb.firstKb)}`,
    `- RSS cuối: ${formatKb(input.serverRssKb.lastKb)}`,
    `- RSS đỉnh: ${formatKb(input.serverRssKb.peakKb)}`,
    '',
    '## Database',
    '',
    `- deadlocks: ${String(input.database.deadlocksBefore)} → ${String(input.database.deadlocksAfter)} (delta ${String(deadlockDelta)})`,
    `- connection server tối đa (application_name): ${String(input.database.maxConnections)}`,
    `- tổng connection tối đa: ${String(input.database.maxTotalConnections)}`,
    `- lock wait tối đa quan sát: ${String(input.database.maxLockWaits)}`,
    `- số mẫu pg_stat_activity: ${String(input.database.samples)}`,
    `- lỗi sampler: ${String(input.database.samplerErrors)}`,
    '',
    '## Invariant sau run',
    '',
    '| Invariant | Kết quả | Chi tiết |',
    '| --- | --- | --- |',
    ...input.invariants.map(
      (item) =>
        `| ${item.name} | ${item.ok ? 'OK' : 'VI PHẠM'} | ${item.detail} |`,
    ),
    '',
    `## Kết luận (invariant): ${invariantVerdict}`,
    '',
    'B1 chỉ đo và in số; ngưỡng PASS/FAIL P1–P19 chờ PO duyệt (Q227–Q236).',
    '',
  ];

  return lines.join('\n');
}
