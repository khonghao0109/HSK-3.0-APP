import { ConflictException, ForbiddenException } from '@nestjs/common';

import {
  assertAdminActor,
  classifyCmsPersistenceError,
  decidePublishAction,
} from './cms-workflow';

describe('CMS workflow policy', () => {
  it('requires the current database-backed actor to be admin', () => {
    expect(() => assertAdminActor({ id: 1, role: 'user' })).toThrow(
      ForbiddenException,
    );
    expect(() => assertAdminActor({ id: 1, role: 'admin' })).not.toThrow();
  });

  it('publishes only the latest revision with an authoritative approval', () => {
    expect(() =>
      decidePublishAction({
        requestedRevisionId: 8,
        latestRevisionId: 9,
        latestDecision: 'approved',
        liveContentHash: null,
        requestedContentHash: 'hash-8',
      }),
    ).toThrow(ConflictException);

    for (const latestDecision of [
      null,
      'changes_requested',
      'rejected',
    ] as const) {
      expect(() =>
        decidePublishAction({
          requestedRevisionId: 9,
          latestRevisionId: 9,
          latestDecision,
          liveContentHash: null,
          requestedContentHash: 'hash-9',
        }),
      ).toThrow(ConflictException);
    }

    expect(
      decidePublishAction({
        requestedRevisionId: 9,
        latestRevisionId: 9,
        latestDecision: 'approved',
        liveContentHash: 'hash-9',
        requestedContentHash: 'hash-9',
      }),
    ).toBe('idempotent');
    expect(
      decidePublishAction({
        requestedRevisionId: 9,
        latestRevisionId: 9,
        latestDecision: 'approved',
        liveContentHash: 'old-hash',
        requestedContentHash: 'hash-9',
      }),
    ).toBe('apply');

    expect(
      decidePublishAction({
        requestedRevisionId: 9,
        latestRevisionId: 9,
        latestDecision: 'approved',
        liveContentHash: 'legacy-locale-dependent-hash',
        requestedContentHash: 'stable-utf16-hash',
        liveContentMatchesRevision: true,
      }),
    ).toBe('idempotent');
  });

  it('classifies unique and transaction races without false-green behavior', () => {
    expect(classifyCmsPersistenceError({ code: 'P2002' })).toBe(
      'unique_conflict',
    );
    expect(classifyCmsPersistenceError({ code: 'P2034' })).toBe(
      'concurrent_retry',
    );
    expect(classifyCmsPersistenceError({ code: 'P2028' })).toBe(
      'concurrent_retry',
    );
    expect(classifyCmsPersistenceError({ code: '55P03' })).toBe('timeout');
    expect(classifyCmsPersistenceError(new Error('unexpected'))).toBe(
      'unknown',
    );
  });
});
