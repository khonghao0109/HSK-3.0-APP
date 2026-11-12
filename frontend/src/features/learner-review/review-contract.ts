import { z } from 'zod';

import { dictionaryWordDetailSchema } from '@/features/learner-dictionary/dictionary-contract';
import { backendEnvelope } from '@/lib/api/backend-envelope';

// Server-only (Zod): docs/api/api.md A.7b. Client components import the
// Zod-free types of review-model.ts, never this module.

const id = z.number().int().positive();
const count = z.number().int().nonnegative();
const grade = z.enum(['again', 'hard', 'good', 'easy']);

const scheduleSchema = z.object({
  state: z.string(),
  dueAt: z.string(),
  intervalDays: z.number(),
});

export const reviewItemSchema = z.object({
  cardId: id,
  state: z.string(),
  dueAt: z.string(),
  word: dictionaryWordDetailSchema,
  preview: z.object({
    again: scheduleSchema,
    hard: scheduleSchema,
    good: scheduleSchema,
    easy: scheduleSchema,
  }),
});

export const reviewSessionSchema = z.object({
  sessionId: id,
  status: z.string(),
  plannedCount: count,
  reviewedCount: count,
  startedAt: z.string(),
  expiresAt: z.string().nullable(),
});

export const reviewQueueEnvelopeSchema = backendEnvelope(
  z.object({ dueCount: count, items: z.array(reviewItemSchema) }),
);
export const reviewCreateEnvelopeSchema = backendEnvelope(
  z.object({ created: z.boolean(), session: reviewSessionSchema }),
);
export const reviewCurrentEnvelopeSchema = backendEnvelope(
  z.object({ session: reviewSessionSchema, items: z.array(reviewItemSchema) }),
);
export const reviewGradeEnvelopeSchema = backendEnvelope(
  z.object({
    replayed: z.boolean(),
    cardId: id,
    grade,
    next: scheduleSchema,
    session: z.object({ reviewedCount: count, plannedCount: count }),
  }),
);
export const reviewCompleteEnvelopeSchema = backendEnvelope(
  z.object({
    session: reviewSessionSchema,
    summary: z.object({
      again: count,
      hard: count,
      good: count,
      easy: count,
      remembered: count,
      forgot: count,
      retentionPercent: z.number().int().min(0).max(100).nullable(),
      totalDurationMs: count,
    }),
  }),
);

const percent = z.number().int().min(0).max(100).nullable();

/** M3.3b (Q268): `GET /review/overview`. */
export const reviewOverviewEnvelopeSchema = backendEnvelope(
  z.object({
    dueToday: count,
    upcoming: z.object({ days3: count, days7: count, days14: count }),
    retention7d: percent,
    calendar: z.array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        reviewed: count,
      }),
    ),
    recentSessions: z.array(
      z.object({
        sessionId: id,
        completedAt: z.string(),
        reviewedCount: count,
        retentionPercent: percent,
      }),
    ),
  }),
);

export const reviewCreateInputSchema = z
  .object({ limit: z.number().int().min(1).max(50).optional() })
  .strict();
export const reviewGradeInputSchema = z
  .object({
    cardId: id,
    grade,
    durationMs: z.number().int().min(0).max(600_000).optional(),
  })
  .strict();

/** A.7b: 8–128 characters `A-Za-z0-9._:-`. */
export const REVIEW_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
export const REVIEW_QUEUE_LIMIT_PATTERN = /^\d{1,2}$/;
