import 'server-only';

import { z } from 'zod';

import { backendPage } from '@/lib/api/backend-envelope';
import { backend } from '@/lib/api/server-backend';

import { EXAM_HISTORY_PAGE_LIMIT } from './exam-history-model';

const itemSchema = z.object({
  attemptId: z.number().int().positive(),
  testId: z.number().int().positive(),
  testTitle: z.string(),
  levelCode: z.string(),
  status: z.enum(['submitted', 'timed_out']),
  finishedAt: z.iso.datetime(),
  score: z.number().nullable(),
  maxScore: z.number().nullable(),
  passScore: z.number().nullable(),
  passed: z.boolean().nullable(),
  skills: z.array(
    z.object({
      skill: z.enum(['listening', 'reading', 'writing', 'speaking']),
      score: z.number(),
      maxScore: z.number(),
    }),
  ),
});

const historyPageSchema = backendPage(itemSchema);

export type ExamHistoryPage = z.infer<typeof historyPageSchema>;

/** One page of the caller's exam history; a backend mismatch fails closed. */
export async function getExamHistory(
  query: { levelCode: string | null; page: number },
  token: string,
): Promise<ExamHistoryPage> {
  const params = new URLSearchParams({
    page: String(query.page),
    limit: String(EXAM_HISTORY_PAGE_LIMIT),
  });
  if (query.levelCode) params.set('levelCode', query.levelCode);
  return historyPageSchema.parse(
    await backend.request(`/api/v1/exam/attempts?${params.toString()}`, {
      token,
    }),
  );
}
