/**
 * M4.4 B3a — Pure planner cho audio preload và tính toán tốc độ cửa sổ trượt.
 *
 * Tôn trọng hành vi frontend preload (exam-audio-preload.ts):
 * - Tuần tự từng audio (concurrency 1)
 * - Gap 6_000 ms giữa 2 lượt tải
 * - Single-flight
 * - Dừng cả phiên khi gặp 429
 *
 * Tính toán tốc độ cửa sổ trượt (60 s) chuẩn O(N) bằng two-pointer.
 */

export const DEFAULT_PRELOAD_GAP_MS = 6_000;

/**
 * Tính đỉnh request/phút theo cửa sổ trượt `windowMs` (mặc định 60_000 ms).
 * Mảng `timestampsMs` là epoch ms của từng request.
 */
export function calculatePeakRequestsPerMinute(
  timestampsMs: readonly number[],
  windowMs = 60_000,
): number {
  if (timestampsMs.length === 0) return 0;
  if (timestampsMs.length === 1) return 1;

  const sorted = [...timestampsMs].sort((left, right) => left - right);
  let peak = 0;
  let left = 0;

  for (let right = 0; right < sorted.length; right += 1) {
    const current = sorted[right];
    while (left <= right && current - sorted[left] >= windowMs) {
      left += 1;
    }
    const count = right - left + 1;
    if (count > peak) peak = count;
  }

  return peak;
}

export type PlannedPreloadItem = {
  mediaId: number;
  url: string;
};

/**
 * Lọc danh sách grant chỉ lấy audio media và đảm bảo thứ tự duy nhất.
 */
export function extractAudioPreloadList(
  grants: ReadonlyArray<{ mediaId: number; kind: string; url: string }>,
): PlannedPreloadItem[] {
  const seen = new Set<number>();
  const result: PlannedPreloadItem[] = [];
  for (const grant of grants) {
    if (grant.kind === 'audio' && !seen.has(grant.mediaId)) {
      seen.add(grant.mediaId);
      result.push({ mediaId: grant.mediaId, url: grant.url });
    }
  }
  return result;
}
