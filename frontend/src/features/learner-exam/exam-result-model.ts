import { EXAM_SKILL_LABELS, type ExamSkill } from './exam-labels';

/**
 * TL-172/Q168: pure presentation rules of the M4.3 result page. Kept free of
 * Zod and of server imports so the page unit tests can pin every branch without
 * rendering the whole backend contract.
 */

/** Q14: a mock exam never grants XP or a badge. */
export const EXAM_RESULT_NO_XP = 'Kết quả thi thử không cộng XP hay huy hiệu.';

/** Q166: no weak area reached the Q154 threshold. */
export const EXAM_RESULT_NO_WEAK_AREAS =
  'Chưa đủ dữ liệu để xác định điểm yếu.';

/** Q167: closed (invalidated) attempts have no result to show. */
export const EXAM_RESULT_CANCELLED = 'Bài thi đã bị huỷ, không có kết quả.';

/** Q167: a retryable internal result failure (the heading names the state). */
export const EXAM_RESULT_RETRY_TEXT = 'Vui lòng thử lại sau ít phút.';

const EXAM_DATE = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** Q168: the exam date is the submission date, in the app time zone. */
export function formatExamDate(submittedAt: string): string {
  return EXAM_DATE.format(new Date(submittedAt));
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Q168: working time = submittedAt − startedAt. `mm:ss`, and `h:mm:ss` from
 * one hour. A negative or invalid pair clamps to `00:00` instead of rendering
 * a nonsense duration.
 */
export function formatExamDuration(
  startedAt: string,
  submittedAt: string,
): string {
  const start = Date.parse(startedAt);
  const end = Date.parse(submittedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return '00:00';
  const total = Math.round((end - start) / 1_000);
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${String(hours)}:${twoDigits(minutes)}:${twoDigits(seconds)}`
    : `${twoDigits(minutes)}:${twoDigits(seconds)}`;
}

/** Q165: the pass line; `passed === null` means the test has no pass score. */
export function passHeadline(passed: boolean | null): string {
  if (passed === null) return 'Đề này chưa đặt điểm đạt';
  return passed ? 'Bạn đã đạt!' : 'Bạn chưa đạt';
}

/** Q165: the badge text, always rendered with an icon next to it (R14). */
export function passBadgeLabel(
  passed: boolean | null,
): 'Đạt' | 'Chưa đạt' | null {
  if (passed === null) return null;
  return passed ? 'Đạt' : 'Chưa đạt';
}

/** Q154: the two weak-area levels the backend can return. */
export function weakAreaLevelLabel(level: 'weak' | 'medium'): string {
  return level === 'weak' ? 'Yếu' : 'Trung bình';
}

/** Section skill → learner label (single source: exam-labels). */
export function skillLabel(skill: ExamSkill): string {
  return EXAM_SKILL_LABELS[skill];
}

/** Sprite symbols already in the learner layout. */
export function skillIcon(skill: ExamSkill): string {
  switch (skill) {
    case 'listening':
      return 'volume';
    case 'reading':
      return 'book-open';
    case 'writing':
      return 'pen-line';
    case 'speaking':
      return 'mic';
  }
}

/** Progress bar value in percent, clamped to 0..100. */
export function progressPercent(score: number, maxScore: number): number {
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round((score / maxScore) * 100)));
}

export type SupportedExamQuestionType =
  'mcq' | 'true_false' | 'fill_blank' | 'arrange_sentence';

export interface QuestionTypeBreakdownItem {
  type: SupportedExamQuestionType;
  label: string;
  correct: number;
  total: number;
}

const QUESTION_TYPE_LABELS: Record<SupportedExamQuestionType, string> = {
  mcq: 'Trắc nghiệm',
  true_false: 'Đúng/Sai',
  fill_blank: 'Điền chỗ trống',
  arrange_sentence: 'Sắp xếp câu',
};

function isSupportedQuestionType(
  type: string,
): type is SupportedExamQuestionType {
  return Object.prototype.hasOwnProperty.call(QUESTION_TYPE_LABELS, type);
}

/**
 * Q220/Q237/Q238: groups review questions by supported objective question type
 * in first-appearance order. Unknown/skill-level types are ignored.
 */
export function questionTypeBreakdown(
  questions: ReadonlyArray<{ type: string; isCorrect: boolean }>,
): QuestionTypeBreakdownItem[] {
  const byType = new Map<
    SupportedExamQuestionType,
    QuestionTypeBreakdownItem
  >();
  for (const question of questions) {
    if (!isSupportedQuestionType(question.type)) continue;
    const existing = byType.get(question.type);
    if (existing) {
      existing.total += 1;
      if (question.isCorrect === true) existing.correct += 1;
    } else {
      byType.set(question.type, {
        type: question.type,
        label: QUESTION_TYPE_LABELS[question.type],
        correct: question.isCorrect === true ? 1 : 0,
        total: 1,
      });
    }
  }
  return Array.from(byType.values());
}
