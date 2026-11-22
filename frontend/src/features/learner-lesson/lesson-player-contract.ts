import { z } from 'zod';

import { lessonStateSchema } from '@/features/learner-path/learning-path-contract';
import { backendEnvelope } from '@/lib/api/backend-envelope';

import {
  FILL_BLANK_MAX_LENGTH,
  MATCHING_MAX_MOVES,
} from './lesson-player-model';

const progressStatusSchema = z.enum(['not_started', 'learning', 'done']);

const exerciseSchema = z.object({
  id: z.number().int().positive(),
  type: z.string(),
  prompt: z.string(),
  // Shape depends on `type`; the player model reads it defensively.
  content: z.unknown(),
  orderIndex: z.number().int(),
  latestAttempt: z.object({ attemptId: z.number().int() }).nullable(),
  // listening_choice audio; read defensively by the player model like content.
  media: z.unknown().optional(),
});

/**
 * The part of `GET /learning/lessons/:lessonId/activity` the player reads
 * (M2.5b, Q45); other fields of the response are dropped.
 */
export const lessonPlayerActivitySchema = z.object({
  lesson: z.object({ id: z.number().int(), title: z.string() }),
  state: lessonStateSchema,
  progress: z.object({ status: progressStatusSchema }),
  topics: z.array(
    z.object({
      id: z.number().int(),
      orderIndex: z.number().int(),
      // Read by the complete BFF (Q58); the player ignores it.
      progress: z.object({ status: progressStatusSchema }),
      exercises: z.array(exerciseSchema),
    }),
  ),
  standaloneExercises: z.array(exerciseSchema),
});
export type LessonPlayerActivity = z.infer<typeof lessonPlayerActivitySchema>;

export const backendLessonPlayerActivitySchema = backendEnvelope(
  lessonPlayerActivitySchema,
);

export const backendLessonStartSchema = backendEnvelope(
  z.object({ lessonId: z.number().int() }),
);

/** `GET /progress/lessons/:lessonId`, read after a 409 on complete. */
export const backendLessonProgressSchema = backendEnvelope(
  z.object({ status: progressStatusSchema }),
);

/** Body the browser sends to `POST /api/learner/topics/:id/complete`. */
export const topicCompleteInputSchema = z.strictObject({
  lessonId: z.number().int().positive().max(2_147_483_647),
});

/**
 * Q-G9: the authored answer the result bar reveals after a wrong attempt. The
 * backend sends it only when `isCorrect === false`; matching never carries it.
 * `.catch(undefined)` drops a malformed shape rather than failing the whole
 * attempt parse, so a bad `correctAnswer` never 503s the submit.
 */
export const correctAnswerSchema = z.union([
  z.object({ optionId: z.string() }),
  z.object({ acceptedTexts: z.array(z.string()), caseSensitive: z.boolean() }),
  z.object({ tokenIds: z.array(z.string()) }),
]);

/** `Attempt` fields the result bar shows; the answer key appears only on a miss. */
export const backendAttemptSchema = backendEnvelope(
  z.object({
    isCorrect: z.boolean().nullable(),
    explanation: z.string().nullable(),
    correctAnswer: correctAnswerSchema.optional().catch(undefined),
  }),
);

// Same rule as the backend scorer's stable ids (option and token ids).
const stableIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N}._:-]*$/u);

/** Body the browser sends to `POST /api/learner/exercises/:id/attempts`. */
export const attemptInputSchema = z.strictObject({
  answer: z.union([
    z.strictObject({ optionId: stableIdSchema }),
    z.strictObject({ tokenIds: z.array(stableIdSchema).min(1).max(100) }),
    // Pha E matching: the move log; the backend replays it and counts mistakes.
    z.strictObject({
      moves: z
        .array(
          z.strictObject({ leftId: stableIdSchema, rightId: stableIdSchema }),
        )
        .min(1)
        .max(MATCHING_MAX_MOVES),
    }),
    z.strictObject({
      text: z.string().trim().min(1).max(FILL_BLANK_MAX_LENGTH),
    }),
  ]),
  durationSeconds: z.number().int().min(0).max(86_400).optional(),
});
