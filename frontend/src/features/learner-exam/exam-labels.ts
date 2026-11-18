import type { components } from '@/lib/api/backend-generated-types';

/** The four skills the exam structure can carry (Q113). */
export type ExamSkill =
  components['schemas']['ExamTestIntroDto']['sections'][number]['skill'];

/** Section skill → Vietnamese label (mẫu exam-intro: "chọn đáp án theo đoạn nghe"). */
export const EXAM_SKILL_LABELS: Record<ExamSkill, string> = {
  listening: 'Nghe',
  reading: 'Đọc',
  writing: 'Viết',
  speaking: 'Nói',
};

/**
 * M4.5 B1: one icon per skill, the same set as the mockups (`exams.html`):
 * headphones, book, pencil, microphone. The listening symbol was added to the
 * learner sprite for this page.
 */
export const EXAM_SKILL_ICONS: Record<ExamSkill, string> = {
  listening: 'headphones',
  reading: 'book-open',
  writing: 'pen-line',
  speaking: 'mic',
};

/** Q211: the three sort orders (mẫu mobile `exams.html`). */
export const EXAM_LIST_SORT_LABELS = {
  newest: 'Mới nhất',
  oldest: 'Cũ nhất',
  score: 'Điểm cao',
} as const;

/** Q212: card status labels, always icon + text (R14: not colour only). */
export const EXAM_LIST_STATUS_LABELS = {
  not_started: 'Chưa làm',
  in_progress: 'Đang làm',
  done: 'Đã làm',
} as const;

/** The second line of the card's end column, per status (mẫu `exams.html`). */
export const EXAM_LIST_STATUS_HINTS = {
  not_started: 'Bắt đầu thi',
  in_progress: 'Làm tiếp',
  done: null,
} as const;

/** Q214: a finished attempt that has no `Result` yet. */
export const EXAM_LIST_NO_SCORE = 'Chưa có điểm';

/** Q226: trophy toast when no visible test at the level has a score yet. */
export const EXAM_LIST_NO_SCORE_HISTORY = 'Chưa có điểm thi thử';

/** Empty state copy of the web mockup (`exams.html`, `.uxb-empty`). */
export const EXAM_LIST_EMPTY_TITLE = 'Chưa có đề ở cấp này';
export const EXAM_LIST_EMPTY_TEXT =
  'Cấp đã chọn chưa có bộ đề đã xuất bản. Chọn cấp khác hoặc quay lại sau.';
export const EXAM_LIST_EMPTY_ACTION = 'Xem tất cả đề';

/** Inline error state: same retry pattern as the result page (Q167). */
export const EXAM_LIST_ERROR_TITLE = 'Chưa tải được danh sách đề';
export const EXAM_LIST_ERROR_TEXT =
  'Không kết nối được máy chủ. Kiểm tra kết nối rồi thử lại.';
export const EXAM_LIST_RETRY = 'Thử lại';

/** The three rules the intro shows (PO 27/10/2026, Q120/Q122). */
export const EXAM_INTRO_RULES = [
  'Bài làm được lưu tự động sau mỗi câu.',
  'Hết giờ hệ thống tự nộp bài, kể cả khi bạn chưa làm hết câu.',
  'Kết quả và giải thích chi tiết có sau khi nộp bài.',
] as const;
