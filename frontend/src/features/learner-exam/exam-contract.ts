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
