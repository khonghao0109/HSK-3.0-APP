import 'server-only';

import { z } from 'zod';

import { backendPage } from '@/lib/api/backend-envelope';
import type { components } from '@/lib/api/backend-generated-types';
import { backend } from '@/lib/api/server-backend';

/**
 * M4.5 B1 (Q209–Q214): `GET /exam/tests` for the list page. The generated
 * contract is the source of truth for the item type; only the fields the page
 * reads are validated, so a backend mismatch fails closed before rendering.
 */
export type ExamTestListItem = components['schemas']['ExamTestListItemDto'];

const skillSchema = z.enum(['listening', 'reading', 'writing', 'speaking']);
const statusSchema = z.enum(['not_started', 'in_progress', 'done']);

const activeAttemptSchema = z.object({
  attemptId: z.number().int().positive(),
  // Nest serializes Date as an ISO string; the page formats it.
  expiresAt: z.iso.datetime(),
});

const latestAttemptSchema = z.object({
  attemptId: z.number().int().positive(),
  status: z.enum(['submitted', 'timed_out']),
  score: z.number().int().nullable(),
  maxScore: z.number().int().nullable(),
  submittedAt: z.iso.datetime(),
  resultAvailable: z.boolean(),
});

const itemSchema = z.object({
  testId: z.number().int().positive(),
  title: z.string(),
  levelCode: z.string(),
  duration: z.number().int().positive(),
  questionCount: z.number().int().nonnegative(),
  skills: z.array(skillSchema),
  status: statusSchema,
  activeAttempt: activeAttemptSchema.nullable(),
  latestAttempt: latestAttemptSchema.nullable(),
});

const listPageSchema = backendPage(itemSchema);

export type ExamListQuery = {
  levelCode: string;
  skill?: z.infer<typeof skillSchema>;
  sort: 'newest' | 'oldest' | 'score';
  page: number;
  limit: number;
};

export type ExamListPage = z.infer<typeof listPageSchema>;

/** One page of the learner exam list plus its pagination meta. */
export async function getExamTestList(
  query: ExamListQuery,
  token: string,
): Promise<ExamListPage> {
  const params = new URLSearchParams({
    levelCode: query.levelCode,
    sort: query.sort,
    page: String(query.page),
    limit: String(query.limit),
  });
  if (query.skill) params.set('skill', query.skill);
  return listPageSchema.parse(
    await backend.request(`/api/v1/exam/tests?${params.toString()}`, { token }),
  );
}
