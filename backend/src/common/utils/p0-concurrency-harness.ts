export type ConcurrencyScenario =
  | 'user-goal-level'
  | 'result-test'
  | 'review-ownership';

export type TransactionOutcome =
  | { status: 'fulfilled' }
  | { status: 'rejected'; reason: unknown };

export type ConcurrentWriteEvidence = {
  transactionA: TransactionOutcome;
  transactionB: TransactionOutcome;
  transactionBStateBeforeRelease: 'blocked' | 'settled';
  finalInvariantHolds: boolean;
};

export type ConcurrencyErrorKind =
  | 'domain_invariant'
  | 'lock_timeout'
  | 'statement_timeout'
  | 'deadlock'
  | 'prisma_transaction_timeout'
  | 'connection_error'
  | 'unique_violation'
  | 'foreign_key_violation'
  | 'check_violation'
  | 'harness_timeout'
  | 'unexpected_error';

export type ClassifiedConcurrencyError = {
  kind: ConcurrencyErrorKind;
  domain?: ConcurrencyScenario;
  sqlState?: string;
  safeMessage: string;
};

export type MigrationOnlyTableCounts = {
  users: number;
  levels: number;
  tests: number;
  results: number;
  reviewCards: number;
  reviewEvents: number;
};

export const FRESH_MIGRATION_ONLY_DATABASE_ERROR =
  'Concurrency test requires a fresh migration-only disposable database.';

export const CONCURRENCY_SCENARIO_LABELS: Record<ConcurrencyScenario, string> =
  {
    'user-goal-level': 'UserGoal/Level race',
    'result-test': 'Result/Test race',
    'review-ownership': 'Review ownership race',
  };

const SQLSTATE_KIND: Partial<Record<string, ConcurrencyErrorKind>> = {
  '55P03': 'lock_timeout',
  '57014': 'statement_timeout',
  '40P01': 'deadlock',
  '23505': 'unique_violation',
  '23503': 'foreign_key_violation',
  '23514': 'check_violation',
};

const CONNECTION_ERROR_CODES = new Set([
  'P1000',
  'P1001',
  'P1002',
  'P1003',
  'P1008',
  'P1010',
  'P1011',
  'P1017',
  'P2024',
]);

const PRISMA_CONSTRAINT_KIND: Partial<Record<string, ConcurrencyErrorKind>> = {
  P2002: 'unique_violation',
  P2003: 'foreign_key_violation',
  P2004: 'check_violation',
};

export class P0ConcurrencyHarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'P0ConcurrencyHarnessError';
  }
}

function collectKnownErrorSignals(
  value: unknown,
  signals: string[],
  seen: Set<object>,
): void {
  if (typeof value === 'string') {
    signals.push(value);
    return;
  }

  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);

  const record = value as Record<string, unknown>;
  for (const key of ['name', 'code', 'message'] as const) {
    if (typeof record[key] === 'string') signals.push(record[key]);
  }

  collectKnownErrorSignals(record.meta, signals, seen);
  collectKnownErrorSignals(record.cause, signals, seen);
}

function findSqlState(signals: string[]): string | undefined {
  const exactState = signals.find(
    (signal) => signal === 'P0001' || SQLSTATE_KIND[signal] !== undefined,
  );
  if (exactState) return exactState;

  const combined = signals.join('\n');
  return combined.match(
    /\b(?:55P03|57014|40P01|23505|23503|23514|P0001)\b/,
  )?.[0];
}

function findPrismaCode(signals: string[]): string | undefined {
  return signals.find((signal) => /^P\d{4}$/.test(signal));
}

function findDomain(combined: string): ConcurrencyScenario | undefined {
  if (
    /Level \d+ update would invalidate UserGoal \d+ targetBand/i.test(combined)
  ) {
    return 'user-goal-level';
  }

  if (
    /Test \d+ Level update would invalidate Result \d+ awardedBand/i.test(
      combined,
    )
  ) {
    return 'result-test';
  }

  if (
    /Review(?:Card|Session) userId is immutable \(row id \d+\)/i.test(combined)
  ) {
    return 'review-ownership';
  }

  return undefined;
}

export function classifyConcurrencyError(
  error: unknown,
): ClassifiedConcurrencyError {
  const signals: string[] = [];
  collectKnownErrorSignals(error, signals, new Set());
  const combined = signals.join('\n');
  const sqlState = findSqlState(signals);
  const prismaCode = findPrismaCode(signals);
  const domain = findDomain(combined);

  if (domain) {
    return {
      kind: 'domain_invariant',
      domain,
      sqlState,
      safeMessage: `expected ${CONCURRENCY_SCENARIO_LABELS[domain]} invariant rejection`,
    };
  }

  const sqlStateKind = sqlState ? SQLSTATE_KIND[sqlState] : undefined;
  if (sqlStateKind) {
    return {
      kind: sqlStateKind,
      sqlState,
      safeMessage: `${sqlStateKind} (SQLSTATE ${sqlState})`,
    };
  }

  const prismaConstraintKind = prismaCode
    ? PRISMA_CONSTRAINT_KIND[prismaCode]
    : undefined;
  if (prismaConstraintKind) {
    return {
      kind: prismaConstraintKind,
      safeMessage: `${prismaConstraintKind} (${prismaCode})`,
    };
  }

  if (prismaCode === 'P2034') {
    return {
      kind: 'deadlock',
      safeMessage: 'deadlock or database write conflict (P2034)',
    };
  }

  if (
    prismaCode === 'P2028' ||
    /transaction (?:already closed|timeout|timed out|expired)|expired transaction/i.test(
      combined,
    )
  ) {
    return {
      kind: 'prisma_transaction_timeout',
      safeMessage: 'Prisma transaction timeout',
    };
  }

  if (
    (prismaCode && CONNECTION_ERROR_CODES.has(prismaCode)) ||
    /cannot reach database|can't reach database|connection (?:refused|closed)|ECONNREFUSED/i.test(
      combined,
    )
  ) {
    return {
      kind: 'connection_error',
      safeMessage: 'database connection error',
    };
  }

  if (/lock timeout|could not obtain lock/i.test(combined)) {
    return { kind: 'lock_timeout', safeMessage: 'lock_timeout' };
  }

  if (/canceling statement due to statement timeout/i.test(combined)) {
    return { kind: 'statement_timeout', safeMessage: 'statement_timeout' };
  }

  if (/deadlock detected/i.test(combined)) {
    return { kind: 'deadlock', safeMessage: 'deadlock' };
  }

  if (/exceeded \d+ms|coordination timeout/i.test(combined)) {
    return {
      kind: 'harness_timeout',
      safeMessage: 'test harness coordination timeout',
    };
  }

  return {
    kind: 'unexpected_error',
    safeMessage: 'unexpected database or test harness error',
  };
}

export function assertSerializedConflict(
  scenario: ConcurrencyScenario,
  evidence: ConcurrentWriteEvidence,
): ClassifiedConcurrencyError {
  const label = CONCURRENCY_SCENARIO_LABELS[scenario];

  if (evidence.transactionA.status !== 'fulfilled') {
    const classified = classifyConcurrencyError(evidence.transactionA.reason);
    throw new P0ConcurrencyHarnessError(
      `${label}: transaction A did not commit (${classified.safeMessage})`,
    );
  }

  if (evidence.transactionBStateBeforeRelease !== 'blocked') {
    throw new P0ConcurrencyHarnessError(
      `${label}: transaction B did not reach a Lock wait before transaction A was released`,
    );
  }

  if (evidence.transactionB.status !== 'rejected') {
    throw new P0ConcurrencyHarnessError(
      `${label}: transaction B committed instead of rejecting the conflicting write`,
    );
  }

  const classified = classifyConcurrencyError(evidence.transactionB.reason);
  if (classified.kind !== 'domain_invariant') {
    throw new P0ConcurrencyHarnessError(
      `${label}: transaction B rejected by ${classified.kind}, not the expected invariant domain`,
    );
  }

  if (classified.domain !== scenario) {
    throw new P0ConcurrencyHarnessError(
      `${label}: transaction B rejected for the wrong invariant domain`,
    );
  }

  if (!evidence.finalInvariantHolds) {
    throw new P0ConcurrencyHarnessError(
      `${label}: final invariant check failed`,
    );
  }

  return classified;
}

export function assertFreshMigrationOnlyCounts(
  counts: MigrationOnlyTableCounts,
): void {
  if (
    Object.values(counts).some(
      (count) => !Number.isInteger(count) || count !== 0,
    )
  ) {
    throw new P0ConcurrencyHarnessError(FRESH_MIGRATION_ONLY_DATABASE_ERROR);
  }
}

export function toSafeConcurrencyErrorMessage(error: unknown): string {
  if (error instanceof P0ConcurrencyHarnessError) return error.message;
  return classifyConcurrencyError(error).safeMessage;
}
