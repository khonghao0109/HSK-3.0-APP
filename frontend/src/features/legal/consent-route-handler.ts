import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { acceptedDocumentSchema } from '@/features/auth/auth-contract';
import {
  isSameOrigin,
  noStore,
  safeResponse,
  setClearedCookies,
  statusFromError,
} from '@/features/auth/session-route-handlers';
import type { ApiFailureKind } from '@/lib/api/api-error';
import { backendEnvelope } from '@/lib/api/backend-envelope';
import { shouldClearLearnerSession } from '@/lib/api/learner-session-failure';

/** `GET /users/me/consents` (api.md A.3b): always terms then privacy. */
export const documentConsentSchema = z.object({
  type: z.enum(['terms', 'privacy']),
  status: z.enum(['accepted', 'pending', 'blocked', 'not_required']),
  version: z.string().min(1).nullable(),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/u)
    .nullable(),
  effectiveAt: z.string().min(1).nullable(),
  deadline: z.string().min(1).nullable(),
});

export const userConsentsResponseSchema = backendEnvelope(
  z.object({
    documents: z.array(documentConsentSchema),
    optional: z.array(z.object({ type: z.string(), granted: z.boolean() })),
  }),
);

const acceptInputSchema = z.strictObject({
  documents: z.array(acceptedDocumentSchema).min(1).max(2),
});

const LEGAL_DOCUMENT_CODES = new Set([
  'LEGAL_DOCUMENT_MISMATCH',
  'LEGAL_CONSENT_REQUIRED',
]);

export type ConsentHandlerDependencies = {
  appOrigin: string;
  learnerCookieName: string;
  production: boolean;
  requestBackend: <T = unknown>(
    path: string,
    options?: {
      token?: string;
      method?: 'GET' | 'POST' | 'PUT';
      body?: unknown;
    },
  ) => Promise<T>;
};

function backendCode(error: unknown): string | undefined {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === 'string' ? code : undefined;
}

function backendFailure(
  error: unknown,
  deps: ConsentHandlerDependencies,
): NextResponse {
  const status = statusFromError(error);
  if (status === 400 && LEGAL_DOCUMENT_CODES.has(backendCode(error) ?? '')) {
    const kind: ApiFailureKind = 'legal_documents_outdated';
    return noStore(
      NextResponse.json(
        {
          success: false,
          error: { kind, message: 'Terms or privacy policy changed.' },
        },
        { status: 400 },
      ),
    );
  }
  if (shouldClearLearnerSession(error)) {
    const response = safeResponse(status);
    setClearedCookies(response, {
      cookieName: deps.learnerCookieName,
      production: deps.production,
    });
    return response;
  }
  if (status === 400 || status === 429) return safeResponse(status);
  return safeResponse(503);
}

/** `POST /api/learner/consents/accept` → `POST /users/me/consents/accept`. */
export async function handleConsentAccept(
  request: NextRequest,
  deps: ConsentHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  const token = request.cookies.get(deps.learnerCookieName)?.value;
  if (!token) return safeResponse(401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return safeResponse(400);
  }
  const input = acceptInputSchema.safeParse(body);
  if (!input.success) return safeResponse(400);

  try {
    await deps.requestBackend('/api/v1/users/me/consents/accept', {
      token,
      method: 'POST',
      body: { documents: input.data.documents },
    });
  } catch (error: unknown) {
    return backendFailure(error, deps);
  }
  return noStore(NextResponse.json({ success: true }));
}

/** Q190: optional consents B3 lets a learner turn on or off. */
const optionalTypeSchema = z.enum(['analytics', 'marketing']);

const optionalInputSchema = z.strictObject({ granted: z.boolean() });

const optionalResponseSchema = backendEnvelope(
  z.object({ type: optionalTypeSchema, granted: z.boolean() }),
);

/**
 * `PUT /api/learner/consents/optional/:type` →
 * `PUT /users/me/consents/optional/:type` (M1.7b2 B3, Q190): records the
 * choice only; nothing is tracked yet (Q200).
 */
export async function handleOptionalConsent(
  request: NextRequest,
  type: string,
  deps: ConsentHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  if (!optionalTypeSchema.safeParse(type).success) return safeResponse(404);
  const token = request.cookies.get(deps.learnerCookieName)?.value;
  if (!token) return safeResponse(401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return safeResponse(400);
  }
  const input = optionalInputSchema.safeParse(body);
  if (!input.success) return safeResponse(400);

  let raw: unknown;
  try {
    raw = await deps.requestBackend(
      `/api/v1/users/me/consents/optional/${type}`,
      { token, method: 'PUT', body: { granted: input.data.granted } },
    );
  } catch (error: unknown) {
    return backendFailure(error, deps);
  }
  const parsed = optionalResponseSchema.safeParse(raw);
  if (!parsed.success || parsed.data.data.type !== type) {
    return safeResponse(503);
  }
  return noStore(NextResponse.json({ success: true, data: parsed.data.data }));
}
