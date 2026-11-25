import 'server-only';

import { z } from 'zod';

import { backend } from '@/lib/api/server-backend';
import { backendEnvelope } from '@/lib/api/backend-envelope';

import { userConsentsResponseSchema } from './consent-route-handler';
import type { CurrentLegalDocument } from './legal-documents';

const currentLegalDocumentsSchema = backendEnvelope(
  z.array(
    z.object({
      type: z.enum(['terms', 'privacy']),
      version: z.string().min(1),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      effectiveAt: z.string().min(1),
    }),
  ),
);

/** Public `GET /legal/documents/current`; `[]` until a version is registered. */
export async function getCurrentLegalDocuments(): Promise<
  CurrentLegalDocument[]
> {
  const response = await backend.request('/api/v1/legal/documents/current');
  return currentLegalDocumentsSchema
    .parse(response)
    .data.map(({ type, version, sha256 }) => ({ type, version, sha256 }));
}

/** The learner's own consent state (`GET /users/me/consents`, api.md A.3b). */
export async function getUserConsents(token: string) {
  const response = await backend.request('/api/v1/users/me/consents', {
    token,
  });
  return userConsentsResponseSchema.parse(response).data.documents;
}
