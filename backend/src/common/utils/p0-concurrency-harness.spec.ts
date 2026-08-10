import {
  assertFreshMigrationOnlyCounts,
  assertSerializedConflict,
  classifyConcurrencyError,
  FRESH_MIGRATION_ONLY_DATABASE_ERROR,
  type ConcurrentWriteEvidence,
  type ConcurrencyScenario,
} from './p0-concurrency-harness';

const DOMAIN_ERRORS: Record<ConcurrencyScenario, string> = {
  'user-goal-level': 'Level 1 update would invalidate UserGoal 9 targetBand',
  'result-test': 'Test 2 Level update would invalidate Result 11 awardedBand',
  'review-ownership': 'ReviewCard userId is immutable (row id 7)',
};

function makeEvidence(scenario: ConcurrencyScenario): ConcurrentWriteEvidence {
  return {
    transactionA: { status: 'fulfilled' },
    transactionB: {
      status: 'rejected',
      reason: {
        code: 'P2010',
        meta: { code: 'P0001', message: DOMAIN_ERRORS[scenario] },
      },
    },
    transactionBStateBeforeRelease: 'blocked',
    finalInvariantHolds: true,
  };
}

describe('classifyConcurrencyError', () => {
  it.each([
    ['user-goal-level', DOMAIN_ERRORS['user-goal-level']],
    ['result-test', DOMAIN_ERRORS['result-test']],
    ['review-ownership', DOMAIN_ERRORS['review-ownership']],
    ['review-ownership', 'ReviewSession userId is immutable (row id 8)'],
  ] as const)('classifies the %s domain rejection', (domain, message) => {
    expect(
      classifyConcurrencyError({
        code: 'P2010',
        meta: { code: 'P0001', message },
      }),
    ).toMatchObject({
      kind: 'domain_invariant',
      domain,
      sqlState: 'P0001',
    });
  });

  it.each([
    ['55P03', 'lock_timeout'],
    ['57014', 'statement_timeout'],
    ['40P01', 'deadlock'],
    ['23505', 'unique_violation'],
    ['23503', 'foreign_key_violation'],
    ['23514', 'check_violation'],
  ] as const)('classifies SQLSTATE %s as %s', (code, kind) => {
    expect(
      classifyConcurrencyError({
        code: 'P2010',
        meta: { code, message: 'database operation rejected' },
      }),
    ).toMatchObject({ kind, sqlState: code });
  });

  it('classifies a Prisma interactive transaction timeout', () => {
    expect(
      classifyConcurrencyError({
        code: 'P2028',
        message: 'Transaction already closed: timeout expired',
      }),
    ).toMatchObject({ kind: 'prisma_transaction_timeout' });
  });

  it.each([
    ['P2002', 'unique_violation'],
    ['P2003', 'foreign_key_violation'],
    ['P2004', 'check_violation'],
    ['P2034', 'deadlock'],
  ] as const)('classifies Prisma error %s as %s', (code, kind) => {
    expect(
      classifyConcurrencyError({ code, message: 'database write failed' }),
    ).toMatchObject({ kind });
  });

  it.each(['P1001', 'P1017', 'P2024'])(
    'classifies Prisma connection error %s',
    (code) => {
      expect(
        classifyConcurrencyError({
          code,
          message: 'Cannot reach database server',
        }),
      ).toMatchObject({ kind: 'connection_error' });
    },
  );

  it('classifies an unknown rejection without exposing its message', () => {
    const secret = 'postgresql://app:do-not-leak@localhost/private_test';
    const classified = classifyConcurrencyError(
      new Error(`Unexpected failure at ${secret}`),
    );

    expect(classified.kind).toBe('unexpected_error');
    expect(classified.safeMessage).not.toContain(secret);
    expect(classified.safeMessage).not.toContain('do-not-leak');
  });
});

describe('assertSerializedConflict', () => {
  it.each(['user-goal-level', 'result-test', 'review-ownership'] as const)(
    'accepts complete GREEN evidence for %s',
    (scenario) => {
      expect(
        assertSerializedConflict(scenario, makeEvidence(scenario)),
      ).toEqual(
        expect.objectContaining({
          kind: 'domain_invariant',
          domain: scenario,
        }),
      );
    },
  );

  it('rejects when transaction A did not commit', () => {
    const evidence = makeEvidence('result-test');
    evidence.transactionA = {
      status: 'rejected',
      reason: { code: 'P2028', message: 'Transaction timeout' },
    };

    expect(() => assertSerializedConflict('result-test', evidence)).toThrow(
      'transaction A did not commit',
    );
  });

  it('rejects when transaction B settled before A was released', () => {
    const evidence = makeEvidence('result-test');
    evidence.transactionBStateBeforeRelease = 'settled';

    expect(() => assertSerializedConflict('result-test', evidence)).toThrow(
      'did not reach a Lock wait',
    );
  });

  it('rejects when transaction B commits after waiting', () => {
    const evidence = makeEvidence('result-test');
    evidence.transactionB = { status: 'fulfilled' };

    expect(() => assertSerializedConflict('result-test', evidence)).toThrow(
      'transaction B committed',
    );
  });

  it.each([
    ['SQLSTATE 55P03', { code: '55P03' }, 'lock_timeout'],
    ['SQLSTATE 57014', { code: '57014' }, 'statement_timeout'],
    ['SQLSTATE 40P01', { code: '40P01' }, 'deadlock'],
    ['SQLSTATE 23505', { code: '23505' }, 'unique_violation'],
    ['SQLSTATE 23503', { code: '23503' }, 'foreign_key_violation'],
    ['SQLSTATE 23514', { code: '23514' }, 'check_violation'],
    [
      'Prisma transaction timeout',
      { code: 'P2028', message: 'Transaction already closed: timeout' },
      'prisma_transaction_timeout',
    ],
    [
      'Prisma connection error',
      { code: 'P1001', message: 'Cannot reach database server' },
      'connection_error',
    ],
  ] as const)(
    'rejects false-green %s',
    (_caseName, reason, expectedClassification) => {
      const evidence = makeEvidence('result-test');
      evidence.transactionB = {
        status: 'rejected',
        reason,
      };

      expect(() => assertSerializedConflict('result-test', evidence)).toThrow(
        `rejected by ${expectedClassification}`,
      );
    },
  );

  it('rejects a valid domain error from the wrong scenario', () => {
    const evidence = makeEvidence('result-test');
    evidence.transactionB = {
      status: 'rejected',
      reason: { code: 'P0001', message: DOMAIN_ERRORS['user-goal-level'] },
    };

    expect(() => assertSerializedConflict('result-test', evidence)).toThrow(
      'wrong invariant domain',
    );
  });

  it('rejects when the final invariant query fails', () => {
    const evidence = makeEvidence('result-test');
    evidence.finalInvariantHolds = false;

    expect(() => assertSerializedConflict('result-test', evidence)).toThrow(
      'final invariant check failed',
    );
  });
});

describe('assertFreshMigrationOnlyCounts', () => {
  const emptyCounts = {
    users: 0,
    levels: 0,
    tests: 0,
    results: 0,
    reviewCards: 0,
    reviewEvents: 0,
  };

  it('accepts a fresh migration-only database', () => {
    expect(() => assertFreshMigrationOnlyCounts(emptyCounts)).not.toThrow();
  });

  it.each(Object.keys(emptyCounts) as Array<keyof typeof emptyCounts>)(
    'rejects a database containing %s before fixture writes',
    (field) => {
      expect(() =>
        assertFreshMigrationOnlyCounts({ ...emptyCounts, [field]: 1 }),
      ).toThrow(FRESH_MIGRATION_ONLY_DATABASE_ERROR);
    },
  );
});
