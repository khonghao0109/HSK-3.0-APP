import 'server-only';

import { backend } from '@/lib/api/server-backend';

import {
  examResultEnvelopeSchema,
  type ExamResultViewParsed,
} from './exam-contract';

/**
 * TL-172: the result page reads through the server, with the same allow-list
 * schema as the BFF route. A backend 4xx left `BackendRequestError` untouched
 * so the page can map Q167 by `status` + `code`; a shape mismatch throws before
 * anything renders.
 */
export async function getExamResult(
  attemptId: number,
  token: string,
): Promise<ExamResultViewParsed> {
  const response = await backend.request(
    `/api/v1/exam/attempts/${attemptId}/result`,
    { token },
  );
  return examResultEnvelopeSchema.parse(response).data;
}
