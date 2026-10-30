import 'server-only';

import { z } from 'zod';

import { backendEnvelope } from '@/lib/api/backend-envelope';
import type { components } from '@/lib/api/backend-generated-types';
import { backend } from '@/lib/api/server-backend';

/** The generated contract is the source of truth for the page's types. */
export type ExamTestIntro = components['schemas']['ExamTestIntroDto'];

/**
 * Only the fields the intro page reads are validated. A mismatch throws before
 * anything renders, so the page fails as a whole (error boundary / 500) rather
 * than showing a partially rendered exam.
 */
const introSectionSchema = z.object({
  orderIndex: z.number().int(),
  title: z.string(),
  skill: z.enum(['listening', 'reading', 'writing', 'speaking']),
  questionCount: z.number().int().nonnegative(),
  maxScore: z.number().int().nonnegative(),
});

const introActiveAttemptSchema = z.object({
  id: z.number().int().positive(),
  // Nest serializes Date as an ISO string; a non-date value would throw in
  // `Intl.DateTimeFormat.format`, so reject it at the boundary.
  startedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  answeredCount: z.number().int().nonnegative(),
  questionCount: z.number().int().nonnegative(),
});

const introSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  instruction: z.string().nullable(),
  levelCode: z.string(),
  durationMinutes: z.number().int().positive(),
  questionCount: z.number().int().nonnegative(),
  sectionCount: z.number().int().nonnegative(),
  maxScore: z.number().int().nonnegative(),
  passScore: z.number().int().nullable(),
  sections: z.array(introSectionSchema),
  activeAttempt: introActiveAttemptSchema.nullable(),
});

const backendIntroSchema = backendEnvelope(introSchema);

/** `GET /exam/tests/:testId` for the intro page (TL-118 step 5). */
export async function getExamIntro(
  testId: number,
  token: string,
): Promise<ExamTestIntro> {
  const response = await backend.request(`/api/v1/exam/tests/${testId}`, {
    token,
  });
  return backendIntroSchema.parse(response).data;
}
