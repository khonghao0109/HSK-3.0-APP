import 'server-only';

import { backend } from '@/lib/api/server-backend';

import { examAttemptEnvelopeSchema } from './exam-contract';
import type { ExamAttemptView } from './exam-take-model';

/**
 * TL-144: the attempt page reads the attempt on the server with the same
 * allowlist schema the BFF GET route uses, so the island never fetches on
 * mount and the browser never sees an unprojected backend payload.
 */
export async function getExamAttempt(
  attemptId: number,
  token: string,
): Promise<ExamAttemptView> {
  const response = await backend.request(`/api/v1/exam/attempts/${attemptId}`, {
    token,
  });
  const parsed = examAttemptEnvelopeSchema.parse(response);
  return parsed.data as ExamAttemptView;
}
