// M1.7b2 B2a: one place deciding what a learner 401/403 means. No Zod and no
// next/server here, so client components may import it (AGENTS.md, CSP).
import { CONSENT_REQUIRED_CODE } from './api-error';

/** Header the BFF sets on its consent 403, read by client components. */
export const CONSENT_RESPONSE_HEADER = 'x-hsk-consent';
/** Request header the proxy sets on learner pages: earliest `pending` deadline. */
export const CONSENT_DEADLINE_HEADER = 'x-hsk-consent-deadline';

const DEFAULT_RETURN_TO = '/learn';
const RETURN_TO_MAX_LENGTH = 512;

function field(error: unknown, key: 'status' | 'code'): unknown {
  return typeof error === 'object' && error !== null && key in error
    ? (error as Record<string, unknown>)[key]
    : undefined;
}

/** Backend 403 CONSENT_REQUIRED: the session stays, the learner must accept. */
export function isConsentRequiredError(error: unknown): boolean {
  return (
    field(error, 'status') === 403 &&
    field(error, 'code') === CONSENT_REQUIRED_CODE
  );
}

/**
 * BFF: clear the learner cookies on 401 and on any 403 but the consent one.
 * Reads `status` like `statusFromError`, so plain `{ status }` errors behave
 * as before.
 */
export function shouldClearLearnerSession(error: unknown): boolean {
  const status = field(error, 'status');
  return status === 401 || (status === 403 && !isConsentRequiredError(error));
}

/**
 * An internal path to come back to after /consent, or `/learn`. Rejects
 * anything that could leave the site (`//host`, `/\\host`, schemes), control
 * characters and /consent itself.
 */
export function safeReturnTo(raw: string | null | undefined): string {
  if (
    typeof raw !== 'string' ||
    raw.length === 0 ||
    raw.length > RETURN_TO_MAX_LENGTH ||
    !raw.startsWith('/') ||
    raw.startsWith('//') ||
    raw.includes('\\') ||
    /[\u0000-\u001f\u007f]/u.test(raw)
  ) {
    return DEFAULT_RETURN_TO;
  }
  const path = raw.split(/[?#]/u, 1)[0] ?? raw;
  if (path === '/consent' || path.startsWith('/consent/')) {
    return DEFAULT_RETURN_TO;
  }
  return raw;
}

export function consentHref(returnTo: string | null | undefined): string {
  return `/consent?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}

/** The BFF's consent 403 (`consent_required`), as a client fetch sees it. */
export function isConsentRequiredResponse(response: Response): boolean {
  return (
    response.status === 403 &&
    response.headers.get(CONSENT_RESPONSE_HEADER) === 'required'
  );
}

/** Full navigation so the proxy and the /consent page read fresh state. */
export function goToConsent(): void {
  window.location.replace(
    consentHref(`${window.location.pathname}${window.location.search}`),
  );
}
