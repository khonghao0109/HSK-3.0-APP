// Zod-free rules of the review session (M3.3a): shared by the BFF-facing
// transport, the client island and their tests.

import {
  allVietnamese,
  displayPinyin,
} from '@/features/learner-dictionary/dictionary-display';

export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';

/** R5: the four buttons, in screen order. */
export const REVIEW_GRADES: ReadonlyArray<{
  grade: ReviewGrade;
  label: string;
  key: '1' | '2' | '3' | '4';
}> = [
  { grade: 'again', label: 'Chưa nhớ', key: '1' },
  { grade: 'hard', label: 'Khó', key: '2' },
  { grade: 'good', label: 'Tốt', key: '3' },
  { grade: 'easy', label: 'Dễ', key: '4' },
];

export type ReviewWord = {
  id: number;
  hanzi: string;
  pinyin: string;
  pinyinTone: string | null;
  example: string | null;
  meanings: ReadonlyArray<{
    order: number;
    vi: string | null;
    en: string | null;
  }>;
};

export type ReviewItem = {
  cardId: number;
  word: ReviewWord;
  preview: Record<ReviewGrade, { dueAt: string }>;
};

export type ReviewSession = {
  sessionId: number;
  status: string;
  plannedCount: number;
  reviewedCount: number;
};

export type ReviewSummary = {
  remembered: number;
  forgot: number;
  retentionPercent: number | null;
  totalDurationMs: number;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Q261: the next-review label of a grade button, from the server preview
 * `dueAt` against the client clock. Units are floored so a label never
 * reaches the next unit early; under one minute still reads "1 phút".
 */
export function intervalLabel(dueAt: string, now: number): string {
  const diff = Date.parse(dueAt) - now;
  if (!(diff >= HOUR)) {
    return `${String(Math.max(1, Math.floor(diff / MINUTE)))} phút`;
  }
  if (diff < DAY) return `${String(Math.floor(diff / HOUR))} giờ`;
  if (diff < 30 * DAY) return `${String(Math.floor(diff / DAY))} ngày`;
  return `${String(Math.floor(diff / (30 * DAY)))} tháng`;
}

/** Q263: "N phút M giây" from the summed review time. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(seconds / 60))} phút ${String(seconds % 60)} giây`;
}

/** Q262: the API accepts an integer `durationMs` in 0–600000. */
export function clampDurationMs(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.min(600_000, Math.max(0, Math.round(ms)));
}

export type GradeFailureAction =
  'skip' | 'expired' | 'retry' | 'unauthorized' | 'error';

/**
 * Q262: what the island does with a failed grade. `status` 0 is a network
 * failure. `retry` resends with the same key (R4).
 */
export function gradeFailureAction(
  status: number,
  code: string | null,
): GradeFailureAction {
  if (
    code === 'REVIEW_CARD_ALREADY_REVIEWED' ||
    code === 'REVIEW_CARD_UNAVAILABLE'
  ) {
    return 'skip';
  }
  if (
    code === 'REVIEW_SESSION_EXPIRED' ||
    code === 'REVIEW_SESSION_NOT_ACTIVE' ||
    status === 404
  ) {
    return 'expired';
  }
  if (status === 0 || status >= 500) return 'retry';
  if (status === 401 || status === 403) return 'unauthorized';
  return 'error';
}

/** Q260: the card faces. Vietnamese meanings joined, English when none. */
export function reviewCardView(word: ReviewWord): {
  hanzi: string;
  pinyin: string;
  meaning: string;
  example: string | null;
} {
  const ordered = [...word.meanings].sort((a, b) => a.order - b.order);
  const english = ordered
    .map((meaning) => meaning.en?.trim() ?? '')
    .filter((en) => en !== '')
    .join('; ');
  return {
    hanzi: word.hanzi,
    pinyin: displayPinyin(word),
    meaning: allVietnamese(ordered) ?? english,
    example: word.example,
  };
}

/** Q260: "x / N", x = graded + 1, never past N. */
export function progressCounter(reviewed: number, planned: number): string {
  return `${String(Math.min(reviewed + 1, planned))} / ${String(planned)}`;
}

export function retentionText(percent: number | null): string {
  return percent === null ? '—' : `${String(percent)}%`;
}
