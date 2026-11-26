import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  isSameOrigin,
  noStore,
  safeResponse,
  setClearedCookies,
  statusFromError,
} from '@/features/auth/session-route-handlers';
import { normalizeApiFailure } from '@/lib/api/api-error';
import { backendEnvelope } from '@/lib/api/backend-envelope';
import { shouldClearLearnerSession } from '@/lib/api/learner-session-failure';

import {
  ACCOUNT_DELETION_CODES,
  DATA_EXPORT_CODES,
  type DataExportItem,
} from './privacy-values';

/**
 * M1.7b2 B2b (Q189): BFF of the learner's data rights. Every backend route
 * here is `@AllowWithoutConsent()`, so a learner blocked on consent reaches
 * them (backend e2e `consent-enforcement.e2e-spec.ts`).
 */
export type PrivacyHandlerDependencies = {
  appOrigin: string;
  learnerCookieName: string;
  production: boolean;
  requestBackend: <T = unknown>(
    path: string,
    options?: { token?: string; method?: 'GET' | 'POST'; body?: unknown },
  ) => Promise<T>;
  rawBackend: (
    path: string,
    options: { headers: Record<string, string> },
  ) => Promise<Response>;
};

/** `GET /users/me/data-exports` (api.md, M1.7b1). */
const dataExportSchema: z.ZodType<DataExportItem> = z.object({
  id: z.number().int().positive(),
  status: z.string().min(1),
  createdAt: z.string().min(1),
  completedAt: z.string().min(1).nullable(),
  outputExpiresAt: z.string().min(1).nullable(),
  downloadable: z.boolean(),
});
const listResponseSchema = backendEnvelope(z.array(dataExportSchema));
const createResponseSchema = backendEnvelope(
  z.object({ exportId: z.number().int().positive(), status: z.string() }),
);
const deletionResponseSchema = backendEnvelope(
  z.object({ requestId: z.number().int(), scheduledAt: z.string().min(1) }),
);
const deletionInputSchema = z.strictObject({
  password: z.string().min(1).max(1024),
});

/** A positive int4, written without leading zeros (route param). */
const EXPORT_ID = /^[1-9][0-9]{0,9}$/u;
const INT4_MAX = 2_147_483_647;

function json(status: number, body: unknown): NextResponse {
  return noStore(NextResponse.json(body, { status }));
}

function backendCode(error: unknown): string | undefined {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === 'string' ? code : undefined;
}

/** `safeResponse`, plus a backend code the page explains (allowlisted). */
function withCode(status: number, code: string): NextResponse {
  const failure = normalizeApiFailure({ status });
  return json(status, {
    success: false,
    error: { kind: failure.kind, message: failure.message, code },
  });
}

function cleared(
  response: NextResponse,
  deps: PrivacyHandlerDependencies,
): NextResponse {
  setClearedCookies(response, {
    cookieName: deps.learnerCookieName,
    production: deps.production,
  });
  return response;
}

function backendFailure(
  error: unknown,
  deps: PrivacyHandlerDependencies,
  codes: ReadonlyMap<string, number>,
): NextResponse {
  const status = statusFromError(error);
  if (shouldClearLearnerSession(error)) {
    return cleared(safeResponse(status), deps);
  }
  const code = backendCode(error);
  if (code !== undefined && codes.get(code) === status) {
    return withCode(status, code);
  }
  if ([400, 404, 429].includes(status)) return safeResponse(status);
  return safeResponse(503);
}

/** `GET /api/learner/data-exports` → `GET /users/me/data-exports`. */
export async function handleListDataExports(
  request: NextRequest,
  deps: PrivacyHandlerDependencies,
): Promise<NextResponse> {
  const token = request.cookies.get(deps.learnerCookieName)?.value;
  if (!token) return safeResponse(401);
  let raw: unknown;
  try {
    raw = await deps.requestBackend('/api/v1/users/me/data-exports', {
      token,
    });
  } catch (error: unknown) {
    return backendFailure(error, deps, DATA_EXPORT_CODES);
  }
  const parsed = listResponseSchema.safeParse(raw);
  if (!parsed.success) return safeResponse(503);
  return json(200, { success: true, data: parsed.data.data });
}

/** `POST /api/learner/data-exports` → `POST /users/me/data-exports` (202). */
export async function handleCreateDataExport(
  request: NextRequest,
  deps: PrivacyHandlerDependencies,
): Promise<NextResponse> {
  if (!isSameOrigin(request, deps.appOrigin)) return safeResponse(403);
  const token = request.cookies.get(deps.learnerCookieName)?.value;
  if (!token) return safeResponse(401);
  let raw: unknown;
  try {
    raw = await deps.requestBackend('/api/v1/users/me/data-exports', {
      token,
      method: 'POST',
    });
  } catch (error: unknown) {
    return backendFailure(error, deps, DATA_EXPORT_CODES);
  }
  const parsed = createResponseSchema.safeParse(raw);
  if (!parsed.success) return safeResponse(503);
  return json(202, { success: true, data: parsed.data.data });
}

/**
 * `GET /api/learner/data-exports/:id/download`: the file the backend serves
 * (owner, 24 h TTL and checksum checked there), as an attachment. The body is
 * passed through and never logged.
 */
export async function handleDataExportDownload(
  request: NextRequest,
  id: string,
  deps: PrivacyHandlerDependencies,
): Promise<NextResponse> {
  if (!EXPORT_ID.test(id) || Number(id) > INT4_MAX) return safeResponse(404);
  const token = request.cookies.get(deps.learnerCookieName)?.value;
  if (!token) return safeResponse(401);
  let upstream: Response;
  try {
    upstream = await deps.rawBackend(
      `/api/v1/users/me/data-exports/${id}/download`,
      { headers: { authorization: `Bearer ${token}` } },
    );
  } catch {
    return safeResponse(503);
  }
  if (upstream.status !== 200) {
    // Error envelope only (small): its code decides, as for every learner BFF.
    const body: unknown = await upstream.json().catch(() => null);
    const failure = {
      status: upstream.status,
      code: backendCode(
        typeof body === 'object' && body !== null && 'error' in body
          ? (body as { error?: unknown }).error
          : undefined,
      ),
    };
    if (shouldClearLearnerSession(failure)) {
      return cleared(safeResponse(upstream.status), deps);
    }
    if (upstream.status === 403) return safeResponse(403);
    return safeResponse(upstream.status === 404 ? 404 : 503);
  }
  let file: ArrayBuffer;
  try {
    file = await upstream.arrayBuffer();
  } catch {
    return safeResponse(503);
  }
  return new NextResponse(file, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="hsk-data-export-${id}.json"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

/**
 * `POST /api/learner/account-deletion` → `POST /users/me/deletion-request`
 * (M1.7c, 7-day grace). The backend revokes every session on 202, so the
 * learner cookies go with it.
 */
export async function handleAccountDeletion(
  request: NextRequest,
  deps: PrivacyHandlerDependencies,
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
  const input = deletionInputSchema.safeParse(body);
  if (!input.success) return safeResponse(400);
  let raw: unknown;
  try {
    raw = await deps.requestBackend('/api/v1/users/me/deletion-request', {
      token,
      method: 'POST',
      body: { password: input.data.password },
    });
  } catch (error: unknown) {
    return backendFailure(error, deps, ACCOUNT_DELETION_CODES);
  }
  const parsed = deletionResponseSchema.safeParse(raw);
  // The deletion is scheduled either way: the session no longer exists.
  const response = parsed.success
    ? json(202, {
        success: true,
        data: { scheduledAt: parsed.data.data.scheduledAt },
      })
    : json(202, { success: true, data: { scheduledAt: null } });
  return cleared(response, deps);
}
