import type { components } from '@/lib/api/backend-generated-types';

import { EXAM_SKILL_LABELS, type ExamSkill } from './exam-labels';

/**
 * M4.2b Pha B (TL-141): pure model of the exam-taking screen. The server page
 * hands the island the parsed attempt; everything here works on that data and
 * never fetches. Kept free of Zod so the `'use client'` island does not pull
 * the schema runtime into the browser bundle.
 */

type GeneratedAttempt = components['schemas']['ExamAttemptViewDto'];
type GeneratedQuestion =
  GeneratedAttempt['sections'][number]['groups'][number]['questions'][number];

/** TL-122 learner answer shape; the generated type for it is unusable. */
export type ExamAnswer =
  | { choice: string }
  | { value: boolean }
  | { text: string }
  | { order: string[] }
  | null;

export type ExamAnswerRow = Omit<
  GeneratedAttempt['answers'][number],
  'answer'
> & { answer: ExamAnswer };

export type ExamAttemptView = Omit<GeneratedAttempt, 'answers'> & {
  answers: ExamAnswerRow[];
};

export type ExamQuestion = GeneratedQuestion;
export type ExamQuestionType = ExamQuestion['type'];
export type ExamSection = ExamAttemptView['sections'][number];
export type ExamGroup = ExamSection['groups'][number];

export type FlatQuestion = {
  /** Position in the whole exam, 1-based. */
  number: number;
  group: ExamGroup;
  section: ExamSection;
  question: ExamQuestion;
};

export const EXAM_FILL_BLANK_MAX_CODE_POINTS = 200;

const FALLBACK_PROMPTS: Partial<Record<ExamQuestionType, string>> = {
  true_false: 'Chọn Đúng hoặc Sai.',
  fill_blank: 'Điền vào chỗ trống.',
  arrange_sentence: 'Sắp xếp thành câu đúng.',
};

export function flattenQuestions(attempt: ExamAttemptView): FlatQuestion[] {
  const flat: FlatQuestion[] = [];
  for (const section of attempt.sections) {
    for (const group of section.groups) {
      for (const question of group.questions) {
        flat.push({ number: flat.length + 1, group, section, question });
      }
    }
  }
  return flat;
}

/** The question line: group then section instruction, then the TL copy. */
export function questionPrompt(entry: FlatQuestion): string {
  const instruction = entry.group.instruction ?? entry.section.instruction;
  if (instruction && instruction.trim().length > 0) return instruction;
  if (entry.question.type === 'mcq' && entry.section.skill === 'listening') {
    return 'Nghe và chọn đáp án đúng.';
  }
  if (entry.question.type === 'mcq') return 'Chọn đáp án đúng.';
  return FALLBACK_PROMPTS[entry.question.type] ?? '';
}

export function questionKicker(entry: FlatQuestion): string {
  const skill = EXAM_SKILL_LABELS[entry.section.skill as ExamSkill];
  return `Phần ${String(entry.section.orderIndex)} · ${skill}`;
}

export function answerOf(
  answers: ExamAnswerRow[],
  questionKey: string,
): ExamAnswer {
  return answers.find((row) => row.questionKey === questionKey)?.answer ?? null;
}

export function isAnswered(answer: ExamAnswer): boolean {
  return answer !== null;
}

export function questionIndexFor(
  flat: FlatQuestion[],
  answers: ExamAnswerRow[],
): number {
  const answered = new Set(
    answers.filter((row) => row.answer !== null).map((row) => row.questionKey),
  );
  const index = flat.findIndex((entry) => !answered.has(entry.question.key));
  return index === -1 ? 0 : index;
}

export function tokenCount(question: ExamQuestion): number {
  return question.type === 'arrange_sentence'
    ? (question.answers.tokens?.length ?? 0)
    : 0;
}

export function isArrangementComplete(
  question: ExamQuestion,
  answer: ExamAnswer,
): boolean {
  if (question.type !== 'arrange_sentence') return false;
  if (answer === null || !('order' in answer)) return false;
  return answer.order.length === tokenCount(question);
}

export type FillBlankBuild =
  | { action: 'clear' }
  | { action: 'send'; answer: { text: string } }
  | { action: 'error'; message: string };

/** TL-136: trim, empty → clear, >200 code points → error and do not send. */
export function buildFillBlankAnswer(text: string): FillBlankBuild {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { action: 'clear' };
  if ([...trimmed].length > EXAM_FILL_BLANK_MAX_CODE_POINTS) {
    return {
      action: 'error',
      message: 'Câu trả lời tối đa 200 ký tự.',
    };
  }
  return { action: 'send', answer: { text: trimmed } };
}

/** What the queue should send for a type given the current UI value. */
export function buildExamAnswer(
  question: ExamQuestion,
  input: {
    choice?: string | null;
    value?: boolean | null;
    text?: string;
    order?: string[];
  },
): { answer: ExamAnswer; error?: string } {
  switch (question.type) {
    case 'mcq':
      return input.choice
        ? { answer: { choice: input.choice } }
        : { answer: null };
    case 'true_false':
      return typeof input.value === 'boolean'
        ? { answer: { value: input.value } }
        : { answer: null };
    case 'fill_blank': {
      const built = buildFillBlankAnswer(input.text ?? '');
      if (built.action === 'error')
        return { answer: null, error: built.message };
      if (built.action === 'clear') return { answer: null };
      return { answer: built.answer };
    }
    case 'arrange_sentence': {
      const order = input.order ?? [];
      const tokens = question.answers.tokens ?? [];
      const complete = order.length === tokens.length;
      return { answer: complete ? { order: [...order] } : null };
    }
    default:
      return { answer: null };
  }
}

export function isSupportedType(type: ExamQuestionType): boolean {
  return (
    type === 'mcq' ||
    type === 'true_false' ||
    type === 'fill_blank' ||
    type === 'arrange_sentence'
  );
}

export function unsupportedTypeMessage(): string {
  return 'Dạng câu này chưa hỗ trợ trong bài thi.';
}
