import { EXAM_SKILL_LABELS, type ExamSkill } from './exam-labels';

/**
 * M4.5 B2c (Q225): pure model of the pre-submit review screen, which is a mode
 * inside the exam-taking island. It only receives learner answer state and the
 * flag bit — never correct answers or explanations — so the review screen
 * cannot leak what the result page may only show after submitting.
 *
 * The input is the narrow slice of the flat question list the screen needs
 * (`number`, `question.key`, section key/order/skill); the island's
 * `FlatQuestion` is structurally assignable, and tests can build plain objects
 * without casts. Kept free of Zod (it is imported by the `'use client'` island).
 */

export const PRE_SUBMIT_REVIEW_TITLE = 'Xem lại bài thi';
export const PRE_SUBMIT_REVIEW_HEADING = 'Chọn câu hỏi để xem lại';
/** Q225: the tip says "come back to the question", never "see the answers". */
export const PRE_SUBMIT_REVIEW_TIP_LABEL = 'Mẹo:';
export const PRE_SUBMIT_REVIEW_TIP = 'Nhấn số câu để quay lại câu đó.';

export type PreSubmitReviewLegendKey = 'answered' | 'unanswered' | 'flagged';

export const PRE_SUBMIT_REVIEW_LEGEND: readonly {
  key: PreSubmitReviewLegendKey;
  label: string;
}[] = [
  { key: 'answered', label: 'Đã trả lời' },
  { key: 'unanswered', label: 'Chưa trả lời' },
  { key: 'flagged', label: 'Đánh dấu' },
];

/** Only the learner's own state; the answer shape is never rendered here. */
export type PreSubmitReviewAnswerState = {
  /** `null` means unanswered; the island's ExamAnswer objects are assignable. */
  answer: object | null;
  isFlagged: boolean;
};

/** The few question fields the review grid needs (FlatQuestion is assignable). */
export type PreSubmitReviewQuestion = {
  number: number;
  question: { key: string };
  section: { key: string; orderIndex: number; skill: ExamSkill };
};

export type PreSubmitReviewCell = {
  /** 0-based position in `flat`. */
  index: number;
  /** 1-based position shown in the grid. */
  number: number;
  questionKey: string;
  answered: boolean;
  flagged: boolean;
  current: boolean;
  /** aria-label, see `reviewCellLabel`. */
  label: string;
};

export type PreSubmitReviewSection = {
  key: string;
  /** `Phần 1 · Nghe`, same kicker as the taking screen. */
  title: string;
  cells: PreSubmitReviewCell[];
};

export type PreSubmitReviewSummary = {
  answered: number;
  unanswered: number;
  flagged: number;
  total: number;
};

export type PreSubmitReviewModel = {
  heading: string;
  legend: typeof PRE_SUBMIT_REVIEW_LEGEND;
  summary: PreSubmitReviewSummary;
  sections: PreSubmitReviewSection[];
  /** Flat list, same order/numbering as the input. */
  cells: PreSubmitReviewCell[];
};

/**
 * R14: the state is in the label, not only in the colour. Flagged comes last so
 * "Câu 12, chưa trả lời, đánh dấu" stays readable with a screen reader (Q225).
 */
export function reviewCellLabel(
  number: number,
  answered: boolean,
  flagged: boolean,
): string {
  const base = `Câu ${number}, ${answered ? 'đã trả lời' : 'chưa trả lời'}`;
  return flagged ? `${base}, đã đánh dấu` : base;
}

export function buildPreSubmitReview(input: {
  flat: readonly PreSubmitReviewQuestion[];
  answers: ReadonlyMap<string, PreSubmitReviewAnswerState>;
  currentIndex: number;
}): PreSubmitReviewModel {
  const { flat, answers, currentIndex } = input;
  const cells: PreSubmitReviewCell[] = [];
  const sections: PreSubmitReviewSection[] = [];
  const sectionByKey = new Map<string, PreSubmitReviewSection>();

  flat.forEach((entry, index) => {
    const state = answers.get(entry.question.key);
    const answered = state !== undefined && state.answer !== null;
    const flagged = state?.isFlagged === true;
    const cell: PreSubmitReviewCell = {
      index,
      number: entry.number,
      questionKey: entry.question.key,
      answered,
      flagged,
      current: index === currentIndex,
      label: reviewCellLabel(entry.number, answered, flagged),
    };
    cells.push(cell);

    let section = sectionByKey.get(entry.section.key);
    if (!section) {
      section = {
        key: entry.section.key,
        title: `Phần ${String(entry.section.orderIndex)} · ${EXAM_SKILL_LABELS[entry.section.skill]}`,
        cells: [],
      };
      sectionByKey.set(entry.section.key, section);
      sections.push(section);
    }
    section.cells.push(cell);
  });

  const answered = cells.filter((cell) => cell.answered).length;
  const flagged = cells.filter((cell) => cell.flagged).length;

  return {
    heading: PRE_SUBMIT_REVIEW_HEADING,
    legend: PRE_SUBMIT_REVIEW_LEGEND,
    summary: {
      answered,
      unanswered: cells.length - answered,
      flagged,
      total: cells.length,
    },
    sections,
    cells,
  };
}
