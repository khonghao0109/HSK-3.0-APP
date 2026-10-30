import { QuestionType, type Prisma } from '@prisma/client';

import { CANONICAL_JSON_MAX_DEPTH } from '../../common/utils/canonical-json';
import { exceedsJsonDepth } from '../../common/utils/json-depth';

/**
 * TL-122: the learner answer shape of the four objective question types. The
 * shape is validated against the frozen snapshot (`snapshot.type` plus the
 * serialized options/tokens), never against the live `Question` row, so an
 * attempt that started before an authoring edit keeps its own contract.
 *
 * The returned object is the value that is stored in `ExamAnswer.answer`.
 * `null` (clearing an answer) is handled by the caller: it is a valid state for
 * every question type.
 */
export const EXAM_ANSWER_LIMITS = {
  maxFillBlankCodePoints: 200,
} as const;

export type ExamAnswerValidation =
  | { ok: true; value: Prisma.InputJsonValue }
  | { ok: false; field: string };

export type ExamAnswerQuestionShape = {
  type: QuestionType;
  answers: Prisma.JsonValue;
};

export function validateExamAnswerShape(
  question: ExamAnswerQuestionShape,
  answer: unknown,
): ExamAnswerValidation {
  // F2: a payload nested past the canonical-JSON bound cannot be hashed for the
  // replay ledger, and no documented answer shape is that deep, so it is a
  // shape error of the whole answer (not of one typed field) — never a 500.
  if (answer !== null && exceedsJsonDepth(answer, CANONICAL_JSON_MAX_DEPTH)) {
    return { ok: false, field: 'answer' };
  }
  switch (question.type) {
    case QuestionType.mcq:
      return validateChoice(question.answers, answer);
    case QuestionType.true_false:
      return validateTrueFalse(answer);
    case QuestionType.fill_blank:
      return validateFillBlank(answer);
    case QuestionType.arrange_sentence:
      return validateOrder(question.answers, answer);
    default:
      // writing/speaking (and the legacy skill types) are not exam answer
      // types in M4.2b (Q112); an attempt that somehow froze one is unusable.
      return { ok: false, field: 'answer' };
  }
}

function validateChoice(
  answers: Prisma.JsonValue,
  answer: unknown,
): ExamAnswerValidation {
  const optionIds = idsOf(answers, 'options');
  if (optionIds === null) return { ok: false, field: 'answer.choice' };

  const record = singleKeyRecord(answer, 'choice');
  if (record === null) return { ok: false, field: 'answer.choice' };
  const choice = record.choice;
  if (typeof choice !== 'string' || !optionIds.has(choice)) {
    return { ok: false, field: 'answer.choice' };
  }
  return { ok: true, value: { choice } };
}

function validateTrueFalse(answer: unknown): ExamAnswerValidation {
  const record = singleKeyRecord(answer, 'value');
  if (record === null || typeof record.value !== 'boolean') {
    return { ok: false, field: 'answer.value' };
  }
  return { ok: true, value: { value: record.value } };
}

function validateFillBlank(answer: unknown): ExamAnswerValidation {
  const record = singleKeyRecord(answer, 'text');
  if (record === null || typeof record.text !== 'string') {
    return { ok: false, field: 'answer.text' };
  }
  // NFC so a decomposed input (e + combining acute) and the composed form are
  // the same answer; trim so accidental whitespace cannot fail grading later.
  const text = record.text.normalize('NFC').trim();
  const codePoints = [...text].length;
  if (
    codePoints < 1 ||
    codePoints > EXAM_ANSWER_LIMITS.maxFillBlankCodePoints
  ) {
    return { ok: false, field: 'answer.text' };
  }
  return { ok: true, value: { text } };
}

function validateOrder(
  answers: Prisma.JsonValue,
  answer: unknown,
): ExamAnswerValidation {
  const tokenIds = idsOf(answers, 'tokens');
  if (tokenIds === null) return { ok: false, field: 'answer.order' };

  const record = singleKeyRecord(answer, 'order');
  if (record === null || !Array.isArray(record.order)) {
    return { ok: false, field: 'answer.order' };
  }
  const order = record.order;
  if (order.length !== tokenIds.size) {
    return { ok: false, field: 'answer.order' };
  }
  const seen = new Set<string>();
  for (const item of order) {
    if (typeof item !== 'string' || !tokenIds.has(item) || seen.has(item)) {
      return { ok: false, field: 'answer.order' };
    }
    seen.add(item);
  }
  return { ok: true, value: { order: order as string[] } };
}

/** The ids of `answers.options` (mcq) or `answers.tokens` (arrange_sentence). */
function idsOf(
  answers: Prisma.JsonValue,
  key: 'options' | 'tokens',
): Set<string> | null {
  const record = plainRecord(answers);
  if (record === null) return null;
  const list = record[key];
  if (!Array.isArray(list)) return null;
  const ids = new Set<string>();
  for (const item of list) {
    const entry = plainRecord(item);
    if (entry === null || typeof entry.id !== 'string') return null;
    if (ids.has(entry.id)) return null;
    ids.add(entry.id);
  }
  return ids;
}

/** An object with exactly one own key — the documented shape, no extras. */
function singleKeyRecord(
  value: unknown,
  key: string,
): Record<string, unknown> | null {
  const record = plainRecord(value);
  if (record === null) return null;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== key) return null;
  return record;
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  // F2: reject a payload that carries an own `__proto__` key. class-transformer
  // rebuilds plain objects with `Object.assign`, and assigning that key changes
  // the prototype instead of adding an own property, which would silently drop
  // the extra key and let a polluted object pass shape validation.
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return null;
  return value as Record<string, unknown>;
}
