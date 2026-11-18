import 'server-only';

import { backend } from '@/lib/api/server-backend';

import {
  examReviewEnvelopeSchema,
  type ExamReviewViewParsed,
} from './exam-contract';

/**
 * M4.5 B2b: the review page reads on the server, like the result page. The
 * backend 4xx stays a `BackendRequestError` so the page can map Q167/Q171 by
 * status + code; a shape mismatch (or a key outside the whitelist) throws
 * before anything renders.
 */
export async function getExamReview(
  attemptId: number,
  token: string,
): Promise<ExamReviewViewParsed> {
  const response = await backend.request(
    `/api/v1/exam/attempts/${attemptId}/review`,
    { token },
  );
  return examReviewEnvelopeSchema.parse(response).data;
}
