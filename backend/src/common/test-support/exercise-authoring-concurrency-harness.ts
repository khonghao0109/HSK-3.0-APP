import { HttpException } from '@nestjs/common';

export type ExerciseAuthoringConcurrencyScenario =
  | 'concurrent-revisions'
  | 'concurrent-publishes'
  | 'publish-archive'
  | 'publish-submit'
  | 'same-actor-publish-submit'
  | 'archive-submit'
  | 'import-idempotency-retry';

export type ExerciseAuthoringTransactionOutcome =
  | { status: 'fulfilled'; value: unknown }
  | { status: 'rejected'; reason: unknown };

export type ExerciseAuthoringRaceEvidence = {
  transactionA: ExerciseAuthoringTransactionOutcome;
  transactionB: ExerciseAuthoringTransactionOutcome;
  transactionBStateBeforeRelease: 'blocked' | 'settled';
  transactionBAfterLockObserved: boolean;
  transactionBContractHolds: boolean;
  finalInvariantHolds: boolean;
};

export type ExpectedExerciseAuthoringBOutcome =
  | { kind: 'commit' }
  | { kind: 'domain_error'; status: number; message: string };

export type ExerciseAuthoringConcurrencyErrorKind =
  | 'lock_timeout'
  | 'statement_timeout'
  | 'deadlock'
  | 'prisma_transaction_timeout'
  | 'connection_error'
  | 'unique_violation'
  | 'foreign_key_violation'
  | 'check_violation'
  | 'http_exception'
  | 'unexpected_error';

export type ClassifiedExerciseAuthoringConcurrencyError = {
  kind: ExerciseAuthoringConcurrencyErrorKind;
  sqlState?: string;
  httpStatus?: number;
  safeMessage: string;
};

export type ExerciseAuthoringMigrationOnlyCounts = {
  users: number;
  levels: number;
  lessons: number;
  topics: number;
  exercises: number;
  attempts: number;
  events: number;
  progresses: number;
  revisions: number;
  reviews: number;
  media: number;
  importJobs: number;
  importRowErrors: number;
  audits: number;
};

export const FRESH_EXERCISE_AUTHORING_DATABASE_ERROR =
  'Exercise Authoring concurrency test requires a fresh migration-only disposable database.';

const SCENARIO_LABELS: Record<ExerciseAuthoringConcurrencyScenario, string> = {
  'concurrent-revisions': 'Concurrent Exercise revisions',
  'concurrent-publishes': 'Concurrent Exercise publishes',
  'publish-archive': 'Exercise publish/archive race',
  'publish-submit': 'Exercise publish/submit race',
  'same-actor-publish-submit': 'Same-actor Exercise publish/submit race',
  'archive-submit': 'Exercise archive/submit race',
  'import-idempotency-retry': 'Exercise import idempotency race',
};

const SQLSTATE_KIND: Partial<
  Record<string, ExerciseAuthoringConcurrencyErrorKind>
> = {
  '55P03': 'lock_timeout',
  '57014': 'statement_timeout',
  '40P01': 'deadlock',
  '23505': 'unique_violation',
  '23503': 'foreign_key_violation',
  '23514': 'check_violation',
};

const PRISMA_KIND: Partial<
  Record<string, ExerciseAuthoringConcurrencyErrorKind>
> = {
  P2002: 'unique_violation',
  P2003: 'foreign_key_violation',
  P2004: 'check_violation',
  P2034: 'deadlock',
};

const CONNECTION_CODES = new Set([
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

export class ExerciseAuthoringConcurrencyHarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExerciseAuthoringConcurrencyHarnessError';
  }
}

export function classifyExerciseAuthoringConcurrencyError(
  error: unknown,
): ClassifiedExerciseAuthoringConcurrencyError {
  const signals: string[] = [];
  collectSafeSignals(error, signals, new Set());
  const sqlState = findSqlState(signals);
  const prismaCode = signals.find((signal) => /^P\d{4}$/u.test(signal));

  const sqlKind = sqlState ? SQLSTATE_KIND[sqlState] : undefined;
  if (sqlKind) {
    return {
      kind: sqlKind,
      sqlState,
      safeMessage: `${sqlKind} (SQLSTATE ${sqlState})`,
    };
  }

  const prismaKind = prismaCode ? PRISMA_KIND[prismaCode] : undefined;
  if (prismaKind) {
    return {
      kind: prismaKind,
      safeMessage: `${prismaKind} (${prismaCode})`,
    };
  }

  if (
    prismaCode === 'P2028' ||
    signals.some((signal) =>
      /transaction (?:already closed|timeout|timed out|expired)|expired transaction/iu.test(
        signal,
      ),
    )
  ) {
    return {
      kind: 'prisma_transaction_timeout',
      safeMessage: 'Prisma transaction timeout',
    };
  }

  if (
    (prismaCode !== undefined && CONNECTION_CODES.has(prismaCode)) ||
    (sqlState !== undefined && /^08[A-Z0-9]{3}$/u.test(sqlState)) ||
    signals.some((signal) =>
      /cannot reach database|can't reach database|connection (?:refused|closed)|ECONNREFUSED/iu.test(
        signal,
      ),
    )
  ) {
    return {
      kind: 'connection_error',
      sqlState,
      safeMessage: 'database connection error',
    };
  }

  if (error instanceof HttpException) {
    return {
      kind: 'http_exception',
      httpStatus: error.getStatus(),
      safeMessage: `HTTP domain rejection (${error.getStatus()})`,
    };
  }

  return {
    kind: 'unexpected_error',
    safeMessage: 'unexpected database or concurrency harness error',
  };
}

export function assertExerciseAuthoringRace(
  scenario: ExerciseAuthoringConcurrencyScenario,
  evidence: ExerciseAuthoringRaceEvidence,
  expectedB: ExpectedExerciseAuthoringBOutcome,
): void {
  const label = SCENARIO_LABELS[scenario];

  if (evidence.transactionA.status !== 'fulfilled') {
    const classified = classifyExerciseAuthoringConcurrencyError(
      evidence.transactionA.reason,
    );
    throw new ExerciseAuthoringConcurrencyHarnessError(
      `${label}: transaction A did not commit (${classified.safeMessage}).`,
    );
  }

  if (evidence.transactionBStateBeforeRelease !== 'blocked') {
    throw new ExerciseAuthoringConcurrencyHarnessError(
      `${label}: transaction B settled before release and did not reach a Lock wait.`,
    );
  }

  if (!evidence.transactionBAfterLockObserved) {
    throw new ExerciseAuthoringConcurrencyHarnessError(
      `${label}: transaction B never crossed the production lock checkpoint.`,
    );
  }

  if (expectedB.kind === 'commit') {
    if (evidence.transactionB.status !== 'fulfilled') {
      const classified = classifyExerciseAuthoringConcurrencyError(
        evidence.transactionB.reason,
      );
      throw new ExerciseAuthoringConcurrencyHarnessError(
        `${label}: transaction B rejected by ${classified.kind}.`,
      );
    }
  } else {
    if (evidence.transactionB.status !== 'rejected') {
      throw new ExerciseAuthoringConcurrencyHarnessError(
        `${label}: transaction B committed instead of the expected domain rejection.`,
      );
    }
    const reason = evidence.transactionB.reason;
    if (
      !(reason instanceof HttpException) ||
      reason.getStatus() !== expectedB.status ||
      reason.message !== expectedB.message
    ) {
      const classified = classifyExerciseAuthoringConcurrencyError(reason);
      throw new ExerciseAuthoringConcurrencyHarnessError(
        `${label}: transaction B rejected outside the expected domain contract (${classified.safeMessage}).`,
      );
    }
  }

  if (!evidence.transactionBContractHolds) {
    throw new ExerciseAuthoringConcurrencyHarnessError(
      `${label}: transaction B response contract failed.`,
    );
  }

  if (!evidence.finalInvariantHolds) {
    throw new ExerciseAuthoringConcurrencyHarnessError(
      `${label}: final database invariant check failed.`,
    );
  }
}

export function assertFreshExerciseAuthoringCounts(
  counts: ExerciseAuthoringMigrationOnlyCounts,
): void {
  if (Object.values(counts).some((count) => count !== 0)) {
    throw new ExerciseAuthoringConcurrencyHarnessError(
      FRESH_EXERCISE_AUTHORING_DATABASE_ERROR,
    );
  }
}

function collectSafeSignals(
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
  for (const key of ['name', 'code', 'sqlState', 'sqlstate', 'message']) {
    if (typeof record[key] === 'string') signals.push(record[key]);
  }
  collectSafeSignals(record.meta, signals, seen);
  collectSafeSignals(record.cause, signals, seen);
}

function findSqlState(signals: string[]): string | undefined {
  const exact = signals.find(
    (signal) =>
      SQLSTATE_KIND[signal] !== undefined || /^08[A-Z0-9]{3}$/u.test(signal),
  );
  if (exact) return exact;
  return signals
    .join('\n')
    .match(/\b(?:55P03|57014|40P01|23505|23503|23514|08[A-Z0-9]{3})\b/u)?.[0];
}
