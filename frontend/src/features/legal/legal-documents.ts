/**
 * M1.7b2: a legal document version as `GET /legal/documents/current` returns
 * it. No Zod here, so client components can import the type (AGENTS.md).
 */
export type CurrentLegalDocument = {
  type: 'terms' | 'privacy';
  version: string;
  sha256: string;
};
