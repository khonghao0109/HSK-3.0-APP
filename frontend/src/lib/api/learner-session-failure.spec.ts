import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackendRequestError, normalizeApiFailure } from './api-error';
import {
  consentHref,
  goToConsent,
  isConsentRequiredError,
  isConsentRequiredResponse,
  safeReturnTo,
  shouldClearLearnerSession,
} from './learner-session-failure';

const backendError = (status: number, code?: string) =>
  new BackendRequestError(
    normalizeApiFailure({
      status,
      body: code === undefined ? null : { error: { code } },
    }),
  );

describe('shouldClearLearnerSession (M1.7b2 B2a)', () => {
  it.each([
    ['401', backendError(401), true],
    ['a plain 403', backendError(403, 'FORBIDDEN'), true],
    ['403 CONSENT_REQUIRED', backendError(403, 'CONSENT_REQUIRED'), false],
    ['200', { status: 200 }, false],
  ] as const)('%s → %s', (_label, error, expected) => {
    expect(shouldClearLearnerSession(error)).toBe(expected);
  });

  it('recognises only the 403 consent failure', () => {
    expect(isConsentRequiredError(backendError(403, 'CONSENT_REQUIRED'))).toBe(
      true,
    );
    expect(isConsentRequiredError(backendError(400, 'CONSENT_REQUIRED'))).toBe(
      false,
    );
    expect(isConsentRequiredError(backendError(403))).toBe(false);
    expect(isConsentRequiredError(new Error('CONSENT_REQUIRED'))).toBe(false);
  });
});

describe('safeReturnTo', () => {
  it.each([
    ['/learn/lessons/12?x=1', '/learn/lessons/12?x=1'],
    ['/onboarding/goal', '/onboarding/goal'],
    [null, '/learn'],
    ['', '/learn'],
    ['//evil.example/x', '/learn'],
    ['/\\evil.example', '/learn'],
    ['https://evil.example/', '/learn'],
    ['javascript:alert(1)', '/learn'],
    ['learn', '/learn'],
    ['/consent?returnTo=/learn', '/learn'],
    ['/learn\nx', '/learn'],
    [`/${'a'.repeat(600)}`, '/learn'],
  ])('%j → %s', (raw, expected) => {
    expect(safeReturnTo(raw)).toBe(expected);
  });

  it('builds the consent href with an encoded, checked return path', () => {
    expect(consentHref('/learn/lessons/3?tab=a&b=1')).toBe(
      '/consent?returnTo=%2Flearn%2Flessons%2F3%3Ftab%3Da%26b%3D1',
    );
    expect(consentHref('//evil.example')).toBe('/consent?returnTo=%2Flearn');
  });
});

describe('BFF consent response on the client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is the 403 carrying the consent header', () => {
    const consent = new Response(null, {
      status: 403,
      headers: { 'x-hsk-consent': 'required' },
    });
    expect(isConsentRequiredResponse(consent)).toBe(true);
    expect(isConsentRequiredResponse(new Response(null, { status: 403 }))).toBe(
      false,
    );
    expect(
      isConsentRequiredResponse(
        new Response(null, {
          status: 401,
          headers: { 'x-hsk-consent': 'required' },
        }),
      ),
    ).toBe(false);
  });

  it('leaves for /consent with the current page as returnTo', () => {
    const replace = vi.fn();
    vi.stubGlobal('location', {
      pathname: '/learn/lessons/7',
      search: '?step=2',
      replace,
    });
    goToConsent();
    expect(replace).toHaveBeenCalledWith(
      '/consent?returnTo=%2Flearn%2Flessons%2F7%3Fstep%3D2',
    );
  });
});
