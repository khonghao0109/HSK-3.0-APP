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

/** The three rules the intro shows (PO 27/10/2026, Q120/Q122). */
export const EXAM_INTRO_RULES = [
  'Bài làm được lưu tự động sau mỗi câu.',
  'Hết giờ hệ thống tự nộp bài, kể cả khi bạn chưa làm hết câu.',
  'Kết quả và giải thích chi tiết có sau khi nộp bài.',
] as const;
