import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  assertExerciseAuthoringRace,
  assertFreshExerciseAuthoringCounts,
  classifyExerciseAuthoringConcurrencyError,
  type ExerciseAuthoringConcurrencyScenario,
  type ExerciseAuthoringMigrationOnlyCounts,
  type ExerciseAuthoringRaceEvidence,
  FRESH_EXERCISE_AUTHORING_DATABASE_ERROR,
} from './exercise-authoring-concurrency-harness';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SCENARIOS: ExerciseAuthoringConcurrencyScenario[] = [
  'concurrent-revisions',
  'concurrent-publishes',
  'publish-archive',
  'publish-submit',
  'same-actor-publish-submit',
  'archive-submit',
  'import-idempotency-retry',
];

function greenEvidence(): ExerciseAuthoringRaceEvidence {
  return {
    transactionA: { status: 'fulfilled', value: { id: 1 } },
    transactionB: { status: 'fulfilled', value: { id: 1 } },
    transactionBStateBeforeRelease: 'blocked',
    transactionBAfterLockObserved: true,
    transactionBContractHolds: true,
    finalInvariantHolds: true,
  };
}

describe('Exercise Authoring concurrency error classifier', () => {
  it.each([
    ['55P03', 'lock_timeout'],
    ['57014', 'statement_timeout'],
    ['40P01', 'deadlock'],
    ['23505', 'unique_violation'],
    ['23503', 'foreign_key_violation'],
    ['23514', 'check_violation'],
    ['08006', 'connection_error'],
  ] as const)('classifies SQLSTATE %s as %s', (code, kind) => {
    expect(
      classifyExerciseAuthoringConcurrencyError({
        code: 'P2010',
        meta: { code, message: 'safe database rejection' },
      }),
    ).toMatchObject({ kind });
  });

  it.each([
    ['P2002', 'unique_violation'],
    ['P2003', 'foreign_key_violation'],
    ['P2004', 'check_violation'],
    ['P2034', 'deadlock'],
    ['P2028', 'prisma_transaction_timeout'],
    ['P1001', 'connection_error'],
    ['P1017', 'connection_error'],
    ['P2024', 'connection_error'],
  ] as const)('classifies Prisma %s as %s', (code, kind) => {
    expect(
      classifyExerciseAuthoringConcurrencyError({
        code,
        message: 'database operation failed',
      }),
    ).toMatchObject({ kind });
  });

  it('classifies an HTTP exception without copying its message', () => {
    const secret = 'postgresql://app:do-not-leak@localhost/private';
    const classified = classifyExerciseAuthoringConcurrencyError(
      new ConflictException(`Archived content ${secret}`),
    );
    expect(classified).toMatchObject({
      kind: 'http_exception',
      httpStatus: 409,
    });
    expect(classified.safeMessage).not.toContain(secret);
    expect(classified.safeMessage).not.toContain('do-not-leak');
  });

  it('never exposes unknown raw error text', () => {
    const secret = 'postgresql://app:do-not-leak@localhost/private';
    const classified = classifyExerciseAuthoringConcurrencyError(
      new Error(`Unexpected ${secret}`),
    );
    expect(classified.kind).toBe('unexpected_error');
    expect(classified.safeMessage).not.toContain(secret);
  });
});

describe('assertExerciseAuthoringRace', () => {
  it.each(SCENARIOS)('accepts complete commit evidence for %s', (scenario) => {
    expect(() =>
      assertExerciseAuthoringRace(scenario, greenEvidence(), {
        kind: 'commit',
      }),
    ).not.toThrow();
  });

  it('accepts only the exact expected domain rejection', () => {
    const evidence = greenEvidence();
    evidence.transactionB = {
      status: 'rejected',
      reason: new ConflictException(
        'Archived LessonExercise cannot be changed.',
      ),
    };
    expect(() =>
      assertExerciseAuthoringRace('publish-archive', evidence, {
        kind: 'domain_error',
        status: 409,
        message: 'Archived LessonExercise cannot be changed.',
      }),
    ).not.toThrow();

    evidence.transactionB = {
      status: 'rejected',
      reason: new NotFoundException('Exercise not found.'),
    };
    expect(() =>
      assertExerciseAuthoringRace('publish-archive', evidence, {
        kind: 'domain_error',
        status: 409,
        message: 'Archived LessonExercise cannot be changed.',
      }),
    ).toThrow('outside the expected domain contract');
  });

  it('rejects when transaction A did not commit', () => {
    const evidence = greenEvidence();
    evidence.transactionA = {
      status: 'rejected',
      reason: { code: 'P2028', message: 'transaction timeout' },
    };
    expect(() =>
      assertExerciseAuthoringRace('concurrent-revisions', evidence, {
        kind: 'commit',
      }),
    ).toThrow('transaction A did not commit');
  });

  it('rejects early settlement and a missing production checkpoint', () => {
    const settled = greenEvidence();
    settled.transactionBStateBeforeRelease = 'settled';
    expect(() =>
      assertExerciseAuthoringRace('concurrent-publishes', settled, {
        kind: 'commit',
      }),
    ).toThrow('did not reach a Lock wait');

    const noCheckpoint = greenEvidence();
    noCheckpoint.transactionBAfterLockObserved = false;
    expect(() =>
      assertExerciseAuthoringRace('concurrent-publishes', noCheckpoint, {
        kind: 'commit',
      }),
    ).toThrow('never crossed the production lock checkpoint');
  });

  it.each([
    ['55P03', 'lock_timeout'],
    ['57014', 'statement_timeout'],
    ['40P01', 'deadlock'],
    ['23505', 'unique_violation'],
    ['23503', 'foreign_key_violation'],
    ['23514', 'check_violation'],
    ['08006', 'connection_error'],
    ['P2028', 'prisma_transaction_timeout'],
    ['P1001', 'connection_error'],
  ] as const)('rejects false-green %s as %s', (code, kind) => {
    const evidence = greenEvidence();
    evidence.transactionB = {
      status: 'rejected',
      reason: { code, message: 'database operation failed' },
    };
    expect(() =>
      assertExerciseAuthoringRace('import-idempotency-retry', evidence, {
        kind: 'commit',
      }),
    ).toThrow(`transaction B rejected by ${kind}`);
  });

  it('rejects a mapped 503 as business success', () => {
    const evidence = greenEvidence();
    evidence.transactionB = {
      status: 'rejected',
      reason: new ServiceUnavailableException('Content operation timed out.'),
    };
    expect(() =>
      assertExerciseAuthoringRace('concurrent-publishes', evidence, {
        kind: 'commit',
      }),
    ).toThrow('transaction B rejected by http_exception');
  });

  it('rejects an invalid response contract and invalid final state', () => {
    const responseMismatch = greenEvidence();
    responseMismatch.transactionBContractHolds = false;
    expect(() =>
      assertExerciseAuthoringRace(
        'import-idempotency-retry',
        responseMismatch,
        {
          kind: 'commit',
        },
      ),
    ).toThrow('response contract failed');

    const invalidFinal = greenEvidence();
    invalidFinal.finalInvariantHolds = false;
    expect(() =>
      assertExerciseAuthoringRace('publish-submit', invalidFinal, {
        kind: 'commit',
      }),
    ).toThrow('final database invariant check failed');
  });
});

describe('assertFreshExerciseAuthoringCounts', () => {
  const empty: ExerciseAuthoringMigrationOnlyCounts = {
    users: 0,
    levels: 0,
    lessons: 0,
    topics: 0,
    exercises: 0,
    attempts: 0,
    events: 0,
    progresses: 0,
    revisions: 0,
    reviews: 0,
    media: 0,
    importJobs: 0,
    importRowErrors: 0,
    audits: 0,
  };

  it('accepts a fresh migration-only database', () => {
    expect(() => assertFreshExerciseAuthoringCounts(empty)).not.toThrow();
  });

  it.each(Object.keys(empty) as Array<keyof typeof empty>)(
    'rejects a database containing %s before fixture INSERT',
    (field) => {
      expect(() =>
        assertFreshExerciseAuthoringCounts({ ...empty, [field]: 1 }),
      ).toThrow(FRESH_EXERCISE_AUTHORING_DATABASE_ERROR);
    },
  );
});

describe('Exercise Authoring concurrency runner production-path contract', () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      'scripts/test/run-exercise-authoring-concurrency.ts',
    ),
    'utf8',
  );

  it('calls production services for all seven races', () => {
    expect(source).toContain(
      "from '../../src/modules/cms/exercise-authoring.service'",
    );
    expect(source).toContain(
      "from '../../src/modules/cms/exercise-import/exercise-import.service'",
    );
    expect(source).toContain(
      "from '../../src/modules/learning/activity/lesson-activity.service'",
    );
    expect(source).toContain('.createExerciseRevision(');
    expect(source).toContain('.publishExerciseRevision(');
    expect(source).toContain('.archiveExercise(');
    expect(source).toContain('.submitAttempt(');
    expect(source).toContain('.commit(');
  });

  it('does not duplicate production transactions or lock helpers', () => {
    expect(source).not.toContain('.$transaction(');
    expect(source).not.toMatch(
      /function\s+lock(?:Lesson|Topic|Exercise)\s*\(/u,
    );
    expect(source).not.toMatch(/transaction\.lessonExercise\.update\s*\(/u);
    expect(source).not.toMatch(/transaction\.contentRevision\.create\s*\(/u);
    expect(source).not.toMatch(/transaction\.importJob\.create\s*\(/u);
  });
});
