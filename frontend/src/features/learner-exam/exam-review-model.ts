import type { ExamReviewQuestionParsed } from './exam-contract';
import { EXAM_SKILL_LABELS, type ExamSkill } from './exam-labels';

/**
 * M4.5 B2b: pure presentation rules for the post-submit review page. Kept free
 * of server imports so the page, the result-page preview and the unit tests all
 * share the same filtering/labelling instead of duplicating strings.
 */

export type ReviewFilter = 'all' | 'wrong' | 'flagged';

export const REVIEW_FILTERS: ReadonlyArray<{
  value: ReviewFilter;
  label: string;
}> = [
  { value: 'all', label: 'Tất cả' },
  { value: 'wrong', label: 'Câu sai' },
  { value: 'flagged', label: 'Đánh dấu' },
];

export function parseReviewFilter(raw: string | undefined): ReviewFilter {
  return raw === 'wrong' || raw === 'flagged' ? raw : 'all';
}

export function reviewFilterHref(
  attemptId: number,
  filter: ReviewFilter,
): string {
  const base = `/learn/exam/attempts/${String(attemptId)}/review`;
  return filter === 'all' ? base : `${base}?filter=${filter}`;
}

export type ReviewStatus = 'correct' | 'wrong' | 'blank';

/** Q148/R14: the state label always renders next to its icon (never colour only). */
export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  correct: 'Đúng',
  wrong: 'Sai',
  blank: 'Chưa trả lời',
};

export const REVIEW_STATUS_ICONS: Record<ReviewStatus, string> = {
  correct: 'check',
  wrong: 'x',
  blank: 'circle',
};

export const REVIEW_FLAG_LABEL = 'Đánh dấu';
export const REVIEW_FLAG_ICON = 'bookmark';

export const REVIEW_SUMMARY_LABELS = {
  answered: 'Đã trả lời',
  blank: 'Chưa trả lời',
  flagged: 'Đánh dấu',
  wrong: 'Câu sai',
} as const;

export const REVIEW_EMPTY_FILTER_TEXT: Record<ReviewFilter, string> = {
  all: 'Chưa có câu nào để xem lại.',
  wrong: 'Bạn không có câu sai nào. Làm tốt lắm!',
  flagged: 'Bạn chưa đánh dấu câu nào.',
};

export const REVIEW_MEDIA_AUDIO_UNAVAILABLE = 'Không tải được âm thanh.';
export const REVIEW_MEDIA_IMAGE_UNAVAILABLE = 'Không tải được hình ảnh.';

export function reviewMediaLabel(
  kind: 'audio' | 'image' | 'pdf' | 'video',
): string {
  return kind === 'audio'
    ? REVIEW_MEDIA_AUDIO_UNAVAILABLE
    : REVIEW_MEDIA_IMAGE_UNAVAILABLE;
}

/** Missing answer = blank; a wrong answer row = wrong; correct wins over flag. */
export function questionStatus(
  question: ExamReviewQuestionParsed,
): ReviewStatus {
  if (question.isCorrect) return 'correct';
  return question.learnerAnswer === null ? 'blank' : 'wrong';
}

export function firstWrongQuestion(
  questions: readonly ExamReviewQuestionParsed[],
): ExamReviewQuestionParsed | null {
  return (
    questions.find((question) => questionStatus(question) === 'wrong') ?? null
  );
}

export function filterQuestions(
  questions: readonly ExamReviewQuestionParsed[],
  filter: ReviewFilter,
): ExamReviewQuestionParsed[] {
  if (filter === 'all') return [...questions];
  if (filter === 'flagged') {
    return questions.filter((question) => question.isFlagged);
  }
  return questions.filter((question) => questionStatus(question) === 'wrong');
}

export type ReviewSummary = {
  total: number;
  answered: number;
  blank: number;
  flagged: number;
  wrong: number;
  correct: number;
};

export function reviewSummary(
  questions: readonly ExamReviewQuestionParsed[],
): ReviewSummary {
  let correct = 0;
  let wrong = 0;
  let blank = 0;
  let flagged = 0;
  for (const question of questions) {
    const status = questionStatus(question);
    if (status === 'correct') correct += 1;
    else if (status === 'wrong') wrong += 1;
    else blank += 1;
    if (question.isFlagged) flagged += 1;
  }
  return {
    total: questions.length,
    answered: correct + wrong,
    blank,
    flagged,
    wrong,
    correct,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A–Z for the first 26 options; then the 1-based number (never a bare glyph). */
export function optionLetter(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

type ReviewOption = { id: string; text: string };

function optionsOf(question: ExamReviewQuestionParsed): ReviewOption[] {
  const answers = asRecord(question.answers);
  const raw = answers?.options;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const option = asRecord(entry);
    if (
      option === null ||
      typeof option.id !== 'string' ||
      typeof option.text !== 'string'
    ) {
      return [];
    }
    return [{ id: option.id, text: option.text }];
  });
}

export type ReviewMcqOption = ReviewOption & {
  letter: string;
  isChosen: boolean;
  isCorrect: boolean;
};

export function mcqOptions(
  question: ExamReviewQuestionParsed,
): ReviewMcqOption[] {
  const learner = asRecord(question.learnerAnswer);
  const correct = asRecord(question.correctAnswer);
  const chosen = typeof learner?.choice === 'string' ? learner.choice : null;
  const right = typeof correct?.optionId === 'string' ? correct.optionId : null;
  return optionsOf(question).map((option, index) => ({
    ...option,
    letter: optionLetter(index),
    isChosen: option.id === chosen,
    isCorrect: option.id === right,
  }));
}

function booleanValue(value: unknown): boolean | null {
  const record = asRecord(value);
  return typeof record?.value === 'boolean' ? record.value : null;
}

export function trueFalseText(value: boolean | null): string {
  if (value === null) return '';
  return value ? 'Đúng' : 'Sai';
}

export function learnerTrueFalse(
  question: ExamReviewQuestionParsed,
): boolean | null {
  return booleanValue(question.learnerAnswer);
}

export function correctTrueFalse(
  question: ExamReviewQuestionParsed,
): boolean | null {
  return booleanValue(question.correctAnswer);
}

function fillText(value: unknown): string {
  const record = asRecord(value);
  return typeof record?.text === 'string' ? record.text : '';
}

export function learnerFillBlank(question: ExamReviewQuestionParsed): string {
  return fillText(question.learnerAnswer).trim();
}

export function correctFillBlank(question: ExamReviewQuestionParsed): string {
  const record = asRecord(question.correctAnswer);
  const accepted = record?.acceptedTexts;
  if (!Array.isArray(accepted)) return '';
  return accepted
    .filter((entry): entry is string => typeof entry === 'string')
    .join(' / ');
}

function orderTokenText(
  question: ExamReviewQuestionParsed,
  value: unknown,
): string {
  const order = asRecord(value)?.order;
  if (!Array.isArray(order)) return '';
  const ids = order.filter(
    (entry): entry is string => typeof entry === 'string',
  );
  if (ids.length === 0) return '';
  const answers = asRecord(question.answers);
  const tokens = Array.isArray(answers?.tokens) ? answers.tokens : [];
  const textById = new Map<string, string>();
  for (const token of tokens) {
    const record = asRecord(token);
    if (typeof record?.id === 'string' && typeof record.text === 'string') {
      textById.set(record.id, record.text);
    }
  }
  return ids.map((id) => textById.get(id) ?? id).join('');
}

export function learnerArrange(question: ExamReviewQuestionParsed): string {
  return orderTokenText(question, question.learnerAnswer);
}

export function correctArrange(question: ExamReviewQuestionParsed): string {
  const correct = asRecord(question.correctAnswer);
  return orderTokenText(question, { order: correct?.tokenIds });
}

/** One-line learner answer for lists/previews (`Chưa trả lời` when blank). */
export function learnerAnswerText(question: ExamReviewQuestionParsed): string {
  if (question.learnerAnswer === null) return '';
  switch (question.type) {
    case 'mcq': {
      const option = mcqOptions(question).find((entry) => entry.isChosen);
      return option === undefined ? '' : `${option.letter}. ${option.text}`;
    }
    case 'true_false':
      return trueFalseText(learnerTrueFalse(question));
    case 'fill_blank':
      return learnerFillBlank(question);
    case 'arrange_sentence':
      return learnerArrange(question);
    default:
      return '';
  }
}

/** One-line correct answer for lists/previews. */
export function correctAnswerText(question: ExamReviewQuestionParsed): string {
  switch (question.type) {
    case 'mcq': {
      const option = mcqOptions(question).find((entry) => entry.isCorrect);
      return option === undefined ? '' : `${option.letter}. ${option.text}`;
    }
    case 'true_false':
      return trueFalseText(correctTrueFalse(question));
    case 'fill_blank':
      return correctFillBlank(question);
    case 'arrange_sentence':
      return correctArrange(question);
    default:
      return '';
  }
}

export type ReviewGroupView = {
  key: string;
  label: string;
  media: ExamReviewQuestionParsed['groupMedia'];
  questions: ExamReviewQuestionParsed[];
};

export type ReviewSectionView = {
  key: string;
  title: string;
  skill: ExamSkill;
  groups: ReviewGroupView[];
};

function ordinal(key: string, prefix: string, fallback: number): number {
  const match = new RegExp(`^${prefix}(\\d+)$`, 'u').exec(key);
  const value = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function sectionTitle(
  sectionKey: string,
  skill: ExamSkill,
  fallbackIndex: number,
): string {
  return `${EXAM_SKILL_LABELS[skill]} · Phần ${String(
    ordinal(sectionKey, 's', fallbackIndex),
  )}`;
}

export function groupLabel(groupKey: string, fallbackIndex: number): string {
  return `Nhóm ${String(ordinal(groupKey.split('-g')[1] ?? '', '', fallbackIndex))}`;
}

/** Sections → groups → questions, preserving the frozen snapshot order. */
export function groupReviewQuestions(
  questions: readonly ExamReviewQuestionParsed[],
): ReviewSectionView[] {
  const sections = new Map<
    string,
    { skill: ExamSkill; groups: Map<string, ReviewGroupView> }
  >();
  for (const question of questions) {
    let section = sections.get(question.sectionKey);
    if (section === undefined) {
      section = { skill: question.skill, groups: new Map() };
      sections.set(question.sectionKey, section);
    }
    let group = section.groups.get(question.groupKey);
    if (group === undefined) {
      group = {
        key: question.groupKey,
        label: groupLabel(question.groupKey, section.groups.size + 1),
        media: question.groupMedia,
        questions: [],
      };
      section.groups.set(question.groupKey, group);
    }
    group.questions.push(question);
  }
  return [...sections.entries()].map(([key, section], index) => ({
    key,
    title: sectionTitle(key, section.skill, index + 1),
    skill: section.skill,
    groups: [...section.groups.values()],
  }));
}
