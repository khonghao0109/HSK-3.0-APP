import {
  CONSENT_GRACE_DAYS,
  ConsentRecord,
  LegalVersionRecord,
  resolveConsentState,
} from './consent-state';

const NOW = new Date('2026-11-23T10:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

const version = (
  type: 'terms' | 'privacy',
  v: string,
  sha256: string,
  effectiveAt: Date,
): LegalVersionRecord => ({ type, version: v, sha256, effectiveAt });

const accepted = (
  type: 'terms' | 'privacy',
  v: string,
  sha256: string,
): ConsentRecord => ({
  type,
  consentVersion: v,
  documentSha256: sha256,
  revokedAt: null,
});

const stateOf = (
  states: ReturnType<typeof resolveConsentState>,
  type: 'terms' | 'privacy',
) => states.find((s) => s.type === type);

describe('resolveConsentState', () => {
  it('uses a 14-day grace window', () => {
    expect(CONSENT_GRACE_DAYS).toBe(14);
  });

  it('returns not_required for both types when no version exists', () => {
    expect(resolveConsentState([], [], NOW)).toEqual([
      {
        type: 'terms',
        status: 'not_required',
        version: null,
        sha256: null,
        effectiveAt: null,
        deadline: null,
      },
      {
        type: 'privacy',
        status: 'not_required',
        version: null,
        sha256: null,
        effectiveAt: null,
        deadline: null,
      },
    ]);
  });

  it('returns accepted when the user accepted the current version', () => {
    const effectiveAt = new Date(NOW.getTime() - 30 * DAY);
    const states = resolveConsentState(
      [version('terms', '1.0', SHA_A, effectiveAt)],
      [accepted('terms', '1.0', SHA_A)],
      NOW,
    );
    expect(stateOf(states, 'terms')).toEqual({
      type: 'terms',
      status: 'accepted',
      version: '1.0',
      sha256: SHA_A,
      effectiveAt,
      deadline: null,
    });
  });

  it('returns pending with the effective date as deadline for a new version within 14 days', () => {
    const newEffective = new Date(NOW.getTime() + 10 * DAY);
    const states = resolveConsentState(
      [
        version('terms', '1.0', SHA_A, new Date(NOW.getTime() - 30 * DAY)),
        version('terms', '1.1', SHA_B, newEffective),
      ],
      [accepted('terms', '1.0', SHA_A)],
      NOW,
    );
    expect(stateOf(states, 'terms')).toEqual({
      type: 'terms',
      status: 'pending',
      version: '1.1',
      sha256: SHA_B,
      effectiveAt: newEffective,
      deadline: newEffective,
    });
  });

  it('counts a version exactly 14 days ahead as current', () => {
    const edge = new Date(NOW.getTime() + 14 * DAY);
    const states = resolveConsentState(
      [version('terms', '1.1', SHA_B, edge)],
      [],
      NOW,
    );
    expect(stateOf(states, 'terms')?.status).toBe('pending');
  });

  it('returns blocked once the effective date has passed without consent', () => {
    const effectiveAt = new Date(NOW.getTime() - 1);
    const states = resolveConsentState(
      [version('privacy', '1.0', SHA_A, effectiveAt)],
      [],
      NOW,
    );
    expect(stateOf(states, 'privacy')).toEqual({
      type: 'privacy',
      status: 'blocked',
      version: '1.0',
      sha256: SHA_A,
      effectiveAt,
      deadline: null,
    });
  });

  it('is blocked at the exact effective instant', () => {
    const states = resolveConsentState(
      [version('privacy', '1.0', SHA_A, NOW)],
      [],
      NOW,
    );
    expect(stateOf(states, 'privacy')?.status).toBe('blocked');
  });

  it('ignores a version more than 14 days ahead', () => {
    const oldEffective = new Date(NOW.getTime() - 30 * DAY);
    const states = resolveConsentState(
      [
        version('terms', '1.0', SHA_A, oldEffective),
        version('terms', '2.0', SHA_B, new Date(NOW.getTime() + 15 * DAY)),
      ],
      [accepted('terms', '1.0', SHA_A)],
      NOW,
    );
    expect(stateOf(states, 'terms')).toMatchObject({
      status: 'accepted',
      version: '1.0',
    });
  });

  it('returns not_required when the only version is more than 14 days ahead', () => {
    const states = resolveConsentState(
      [version('terms', '1.0', SHA_A, new Date(NOW.getTime() + 15 * DAY))],
      [],
      NOW,
    );
    expect(stateOf(states, 'terms')?.status).toBe('not_required');
  });

  it('does not count consent to an old version as consent to the new one', () => {
    const states = resolveConsentState(
      [
        version('terms', '1.0', SHA_A, new Date(NOW.getTime() - 60 * DAY)),
        version('terms', '1.1', SHA_B, new Date(NOW.getTime() - DAY)),
      ],
      [accepted('terms', '1.0', SHA_A)],
      NOW,
    );
    expect(stateOf(states, 'terms')).toMatchObject({
      status: 'blocked',
      version: '1.1',
    });
  });

  it('does not count a consent whose hash differs from the current version', () => {
    const states = resolveConsentState(
      [version('terms', '1.0', SHA_A, new Date(NOW.getTime() - DAY))],
      [accepted('terms', '1.0', SHA_C)],
      NOW,
    );
    expect(stateOf(states, 'terms')?.status).toBe('blocked');
  });

  it('does not count a revoked consent', () => {
    const states = resolveConsentState(
      [version('terms', '1.0', SHA_A, new Date(NOW.getTime() - DAY))],
      [{ ...accepted('terms', '1.0', SHA_A), revokedAt: NOW }],
      NOW,
    );
    expect(stateOf(states, 'terms')?.status).toBe('blocked');
  });

  it('resolves terms and privacy independently', () => {
    const past = new Date(NOW.getTime() - DAY);
    const states = resolveConsentState(
      [
        version('terms', '1.0', SHA_A, past),
        version('privacy', '1.0', SHA_B, past),
      ],
      [accepted('terms', '1.0', SHA_A)],
      NOW,
    );
    expect(stateOf(states, 'terms')?.status).toBe('accepted');
    expect(stateOf(states, 'privacy')?.status).toBe('blocked');
  });

  it('does not let a terms consent satisfy privacy with the same version and hash', () => {
    const past = new Date(NOW.getTime() - DAY);
    const states = resolveConsentState(
      [version('privacy', '1.0', SHA_A, past)],
      [accepted('terms', '1.0', SHA_A)],
      NOW,
    );
    expect(stateOf(states, 'privacy')?.status).toBe('blocked');
  });
  it('keeps blocked a user who never accepted the version in force, even with a newer one within 14 days', () => {
    const newEffective = new Date(NOW.getTime() + 10 * DAY);
    const states = resolveConsentState(
      [
        version('terms', '1.0', SHA_A, new Date(NOW.getTime() - 30 * DAY)),
        version('terms', '1.1', SHA_B, newEffective),
      ],
      [],
      NOW,
    );
    expect(stateOf(states, 'terms')).toEqual({
      type: 'terms',
      status: 'blocked',
      version: '1.1',
      sha256: SHA_B,
      effectiveAt: newEffective,
      deadline: null,
    });
  });

  it('lets a user accept the upcoming version directly to clear that block', () => {
    const states = resolveConsentState(
      [
        version('terms', '1.0', SHA_A, new Date(NOW.getTime() - 30 * DAY)),
        version('terms', '1.1', SHA_B, new Date(NOW.getTime() + 10 * DAY)),
      ],
      [accepted('terms', '1.1', SHA_B)],
      NOW,
    );
    expect(stateOf(states, 'terms')?.status).toBe('accepted');
  });
});
