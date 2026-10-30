import { z } from 'zod';

import { backendEnvelope } from '@/lib/api/backend-envelope';

/**
 * M4.2a (TL-118): the BFF contract of the exam start route. Only the fields the
 * browser needs are parsed: the question tree stays on the server.
 */
export const examStartInputSchema = z.strictObject({
  // Zod 4: `z.uuid()`. The backend also validates the body, so this is the
  // first gate, not the only one.
  idempotencyKey: z.uuid(),
});

/**
 * `POST /api/v1/exam/tests/:testId/attempts` answers 201 (new attempt) or 200
 * (replay / live attempt); both carry these fields inside the success
 * envelope. Only these three fields are forwarded to the browser — the
 * question tree stays on the server (TL-118 step 6). The status mirrors the
 * backend `ExamAttemptStatus` enum so a new value cannot leak silently.
 */
export const examStartBackendSchema = backendEnvelope(
  z.object({
    id: z.number().int().positive(),
    status: z.enum(['in_progress', 'submitted', 'timed_out', 'invalidated']),
    expiresAt: z.iso.datetime(),
  }),
);

export type ExamStartInput = z.infer<typeof examStartInputSchema>;

// ---------------------------------------------------------------------------
// M4.2b Pha B (TL-134): the attempt-taking contract. Inputs are strict (the
// browser must not smuggle extra fields); backend responses use `z.object` so
// unknown keys are stripped here instead of reaching the client (R11).
// ---------------------------------------------------------------------------

/** Snapshot question key (`q<orderIndex>`); the backend pipe accepts `q\d+`. */
export const EXAM_QUESTION_KEY_PATTERN = /^q[1-9]\d{0,8}$/;

export const EXAM_STATUS_VALUES = [
  'in_progress',
  'submitted',
  'timed_out',
  'invalidated',
] as const;

const questionTypeSchema = z.enum([
  'mcq',
  'true_false',
  'fill_blank',
  'arrange_sentence',
  'listening',
  'reading',
  'writing',
  'speaking',
]);

/**
 * The four answer shapes of TL-122 plus `null` (clear). Every object carries
 * exactly one key; `text` is bounded here and by the backend (200 code points).
 */
const tokenIdSchema = z.string().regex(/^t[1-9]\d{0,2}$/);

export const examAnswerSchema = z.union([
  z.strictObject({ choice: z.string().min(1).max(128) }),
  z.strictObject({ value: z.boolean() }),
  z.strictObject({ text: z.string().max(1000) }),
  z.strictObject({ order: z.array(tokenIdSchema).min(1).max(100) }),
  z.null(),
]);

export const examSaveAnswerInputSchema = z.strictObject({
  answer: examAnswerSchema,
  isFlagged: z.boolean(),
  expectedVersion: z.number().int().min(1).nullable(),
  idempotencyKey: z.uuid(),
});

const examSaveAnswerItemInputSchema = examSaveAnswerInputSchema.extend({
  questionKey: z.string().regex(EXAM_QUESTION_KEY_PATTERN),
});

export const examSaveAnswersInputSchema = z.strictObject({
  items: z.array(examSaveAnswerItemInputSchema).min(1).max(20),
});

const mediaSchema = z.object({
  mediaId: z.number().int().positive(),
  kind: z.enum(['audio', 'image', 'pdf', 'video']),
  mimeType: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
});

const optionSchema = z.object({ id: z.string(), text: z.string() });

/** Only mcq (`options`) and arrange_sentence (`tokens`) carry render data. */
const questionAnswersSchema = z.object({
  options: z.array(optionSchema).optional(),
  tokens: z.array(optionSchema).optional(),
});

const attemptQuestionSchema = z.object({
  key: z.string(),
  orderIndex: z.number().int(),
  type: questionTypeSchema,
  skill: z.enum(['listening', 'reading', 'writing', 'speaking']),
  content: z.string(),
  answers: questionAnswersSchema,
  audio: mediaSchema.nullable(),
  image: mediaSchema.nullable(),
});

// TL-134.4: `group.content` is arbitrary JSON and is deliberately NOT part of
// this projection; `z.object` strips it, so a forbidden key inside it can never
// reach the browser.
const attemptGroupSchema = z.object({
  key: z.string(),
  orderIndex: z.number().int(),
  title: z.string().nullable(),
  instruction: z.string().nullable(),
  audio: mediaSchema.nullable(),
  image: mediaSchema.nullable(),
  questions: z.array(attemptQuestionSchema),
});

const attemptSectionSchema = z.object({
  key: z.string(),
  orderIndex: z.number().int(),
  title: z.string(),
  instruction: z.string().nullable(),
  skill: z.enum(['listening', 'reading', 'writing', 'speaking']),
  groups: z.array(attemptGroupSchema),
});

const answerViewSchema = z.object({
  questionKey: z.string().regex(EXAM_QUESTION_KEY_PATTERN),
  answer: examAnswerSchema,
  isFlagged: z.boolean(),
  version: z.number().int().min(1),
  answeredAt: z.iso.datetime().nullable(),
  lastSavedAt: z.iso.datetime(),
});

export const examAttemptViewSchema = z.object({
  id: z.number().int().positive(),
  testId: z.number().int().positive(),
  status: z.enum(EXAM_STATUS_VALUES),
  startedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  serverNow: z.iso.datetime(),
  remainingSeconds: z.number().int().nonnegative(),
  maxScore: z.number().int().nonnegative(),
  questionCount: z.number().int().nonnegative(),
  test: z.object({
    title: z.string(),
    instruction: z.string().nullable(),
    levelCode: z.string(),
    durationMinutes: z.number().int().positive(),
    passScore: z.number().int().nullable(),
  }),
  sections: z.array(attemptSectionSchema),
  answers: z.array(answerViewSchema),
});

export const examAnswerSaveViewSchema = answerViewSchema.extend({
  serverNow: z.iso.datetime(),
  remainingSeconds: z.number().int().nonnegative(),
});

const batchResultStatusSchema = z.enum([
  'saved',
  'replayed',
  'conflict',
  'invalid',
  'not_found',
]);

export const examAnswerBatchViewSchema = z.object({
  results: z.array(
    z.object({
      questionKey: z.string(),
      status: batchResultStatusSchema,
      answer: answerViewSchema.optional(),
      code: z.string().max(64).optional(),
      current: answerViewSchema.nullable().optional(),
    }),
  ),
  serverNow: z.iso.datetime(),
  remainingSeconds: z.number().int().nonnegative(),
});

export const examMediaGrantsBackendSchema = z.object({
  grants: z.array(
    z.object({
      mediaId: z.number().int().positive(),
      kind: z.enum(['audio', 'image', 'pdf', 'video']),
      url: z.string(),
      expiresAt: z.iso.datetime(),
    }),
  ),
  unavailable: z.array(z.number().int().positive()),
});

export const examAttemptEnvelopeSchema = backendEnvelope(examAttemptViewSchema);
export const examAnswerSaveEnvelopeSchema = backendEnvelope(
  examAnswerSaveViewSchema,
);
export const examAnswerBatchEnvelopeSchema = backendEnvelope(
  examAnswerBatchViewSchema,
);
export const examMediaGrantsBackendEnvelopeSchema = backendEnvelope(
  examMediaGrantsBackendSchema,
);

export type ExamAnswerInput = z.infer<typeof examAnswerSchema>;
export type ExamSaveAnswerInput = z.infer<typeof examSaveAnswerInputSchema>;
export type ExamSaveAnswersInput = z.infer<typeof examSaveAnswersInputSchema>;
export type ExamAttemptViewParsed = z.infer<typeof examAttemptViewSchema>;
export type ExamAnswerSaveViewParsed = z.infer<typeof examAnswerSaveViewSchema>;
export type ExamAnswerBatchViewParsed = z.infer<
  typeof examAnswerBatchViewSchema
>;
