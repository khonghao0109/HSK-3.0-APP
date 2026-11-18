/**
 * M1.7d / Q203 database races for admin-initiated account deletion.
 *
 * Run against a fresh migration-only disposable database (for example
 * `hsk_b1_hardening`); every scenario repeats ROUNDS times and the harness
 * fails on any deadlock (40P01), lock/statement timeout or unexpected error.
 *
 *  A: admin escalation races the login cancellation path (M1.7c). The admin
 *     request must never be cancelled, exactly one `requested` row must survive
 *     and the login outcome must be deterministic (success or the decoy 401).
 *  B: admin mutation races the anonymize worker at the due moment. The account
 *     is anonymized exactly once and never from a request that is not due.
 *  C: two admins request the deletion of the same user concurrently: exactly
 *     one `requested` row and one audit row, both calls answer the same request.
 *  D: a self-service request races an admin request: the partial unique index
 *     must keep a single `requested` row and the admin owns it at the end.
 */
import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';

import { assertDisposableTestDatabase } from '../../src/common/utils/assert-disposable-test-database';
import { InMemoryJobQueue } from '../../src/infrastructure/jobs/in-memory-job-queue.adapter';
import { PostgresThrottlerStorage } from '../../src/infrastructure/rate-limit/postgres-throttler.storage';
import { AdminUsersService } from '../../src/modules/admin-users/admin-users.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { hashPasswordWithPepper } from '../../src/modules/auth/utils/password-hasher';
import { AnonymizeAccountJob } from '../../src/modules/user/jobs/anonymize-account.job';
import { RequestAccountDeletionDto } from '../../src/modules/user/dto/request-account-deletion.dto';
import { UserService } from '../../src/modules/user/user.service';
import { PrismaService } from '../../src/prisma/prisma.service';

const ROUNDS = 20;
const PASSWORD = 'Race-harness-pass-123!';
const PEPPER = '';
const PREFIX = `b1_del_race_${Date.now()}`;

type Outcome =
  | { status: 'fulfilled'; value: unknown }
  | { status: 'rejected'; reason: unknown };

type Refusal = {
  httpStatus: number | null;
  code: string | null;
  message: string;
};

const database = assertDisposableTestDatabase();
console.log(`database under test: ${database.databaseName}`);

const prisma = new PrismaService();
const config = new ConfigService({
  AUTH_PASSWORD_PEPPER: PEPPER,
  jwt: {
    secrets: { harness: 'harness-secret-at-least-32-characters' },
    activeKid: 'harness',
    refreshTokenTtlDays: 30,
  },
});
const jobQueue = new InMemoryJobQueue();
const rateLimitStorage = new PostgresThrottlerStorage(prisma);
const adminUsers = new AdminUsersService(prisma, jobQueue);
const userService = new UserService(prisma, config, jobQueue);
const authService = new AuthService(
  prisma,
  new JwtService({ secret: 'harness-unused' }),
  config,
  rateLimitStorage,
  jobQueue,
);
const anonymizeJob = new AnonymizeAccountJob(null, prisma, config);

let failed = false;

function check(label: string, condition: boolean, detail: string): void {
  if (condition) {
    console.log(`PASS ${label}`);
    return;
  }
  failed = true;
  console.error(`FAIL ${label}: ${detail}`);
}

function httpCodeOf(error: HttpException): string | null {
  const response = error.getResponse();
  if (typeof response !== 'object' || response === null) return null;
  const value = (response as Record<string, unknown>).code;
  return typeof value === 'string' ? value : null;
}

function refusalOf(error: unknown): Refusal {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof HttpException) {
    return {
      httpStatus: error.getStatus(),
      code: httpCodeOf(error),
      message,
    };
  }
  return { httpStatus: null, code: null, message };
}

/** A deadlock, serialization failure or lock timeout must fail the harness. */
function isLockFault(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  ) {
    return true;
  }
  return /40P01|40001|55P03|deadlock detected|lock timeout|could not serialize/i.test(
    message,
  );
}

/** A P2002 on the partial unique index would mean the write path is unguarded. */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function settleAll(promises: Array<Promise<unknown>>): Promise<Outcome[]> {
  return Promise.allSettled(promises).then((results) =>
    results.map((result): Outcome => {
      if (result.status === 'fulfilled') {
        return { status: 'fulfilled', value: result.value };
      }
      const reason: unknown = result.reason;
      return { status: 'rejected', reason };
    }),
  );
}

let passwordHash = '';

async function createUser(
  label: string,
): Promise<{ id: number; email: string }> {
  return prisma.user.create({
    data: {
      email: `${PREFIX}_${label}@example.test`,
      password: passwordHash,
      name: `Race ${label}`,
      role: 'user',
      status: 'active',
    },
    select: { id: true, email: true },
  });
}

async function createAdmin(label: string): Promise<number> {
  const admin = await prisma.user.create({
    data: {
      email: `${PREFIX}_${label}@example.test`,
      password: passwordHash,
      name: `Race ${label}`,
      role: 'admin',
      status: 'active',
    },
    select: { id: true },
  });
  return admin.id;
}

function selfDeletionRequest(userId: number) {
  return userService.requestAccountDeletion(
    userId,
    Object.assign(new RequestAccountDeletionDto(), { password: PASSWORD }),
  );
}

async function runScenarioA(adminId: number): Promise<void> {
  console.log(
    `\n== Scenario A: admin escalation || login cancellation (${ROUNDS} rounds)`,
  );
  const actor = { id: adminId, role: 'admin' };

  for (let round = 1; round <= ROUNDS; round += 1) {
    const user = await createUser(`a${round}`);
    await selfDeletionRequest(user.id);
    jobQueue.clear();

    const [adminOutcome, loginOutcome] = await settleAll([
      adminUsers.requestDeletionByAdmin(actor, user.id, 'under_age', {
        correlationId: `b1-a-${round}`,
      }),
      authService.login({ email: user.email, password: PASSWORD }),
    ]);

    const label = `A round ${round}`;

    for (const outcome of [adminOutcome, loginOutcome]) {
      if (outcome.status === 'rejected' && isLockFault(outcome.reason)) {
        check(
          `${label} no deadlock/lock timeout`,
          false,
          refusalOf(outcome.reason).message,
        );
        return;
      }
    }

    check(
      `${label} admin call succeeds`,
      adminOutcome.status === 'fulfilled',
      adminOutcome.status === 'rejected'
        ? refusalOf(adminOutcome.reason).message
        : 'ok',
    );

    if (loginOutcome.status === 'rejected') {
      const refusal = refusalOf(loginOutcome.reason);
      check(
        `${label} rejected login is the decoy 401`,
        refusal.httpStatus === 401,
        JSON.stringify(refusal),
      );
    }

    const requested = await prisma.accountDeletionRequest.findMany({
      where: { userId: user.id, status: 'requested' },
      select: { id: true, initiatedBy: true, scheduledAt: true },
    });
    check(
      `${label} exactly one requested row`,
      requested.length === 1,
      JSON.stringify(requested),
    );
    check(
      `${label} requested row is owned by admin`,
      requested[0]?.initiatedBy === 'admin',
      JSON.stringify(requested[0]),
    );

    const adminCancelled = await prisma.accountDeletionRequest.count({
      where: { userId: user.id, status: 'cancelled', initiatedBy: 'admin' },
    });
    check(
      `${label} admin request never cancelled`,
      adminCancelled === 0,
      `cancelled admin rows: ${adminCancelled}`,
    );

    const userRow = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { status: true },
    });
    check(
      `${label} user ends deletion_pending`,
      userRow.status === 'deletion_pending',
      userRow.status,
    );

    const adminAudits = await prisma.auditLog.count({
      where: {
        action: 'account.deletion_requested_by_admin',
        targetId: String(user.id),
      },
    });
    check(
      `${label} one admin audit row`,
      adminAudits === 1,
      `audits: ${adminAudits}`,
    );

    const cancelAudits = await prisma.auditLog.count({
      where: {
        action: 'account.deletion_cancelled',
        targetId: String(user.id),
      },
    });
    const expectedCancelAudits = loginOutcome.status === 'fulfilled' ? 1 : 0;
    check(
      `${label} cancellation audit matches the login outcome`,
      cancelAudits === expectedCancelAudits,
      `expected ${expectedCancelAudits}, got ${cancelAudits}`,
    );
  }
}

async function runScenarioB(adminId: number): Promise<void> {
  console.log(
    `\n== Scenario B: admin mutation || anonymize worker at due time (${ROUNDS} rounds)`,
  );
  const actor = { id: adminId, role: 'admin' };

  for (let round = 1; round <= ROUNDS; round += 1) {
    const user = await createUser(`b${round}`);
    const request = await prisma.accountDeletionRequest.create({
      data: {
        userId: user.id,
        status: 'requested',
        initiatedBy: 'user',
        verifiedAt: new Date(),
        scheduledAt: new Date(Date.now() - 1_000),
      },
      select: { id: true },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'deletion_pending', deletedAt: new Date() },
    });
    jobQueue.clear();

    const [adminOutcome, workerOutcome] = await settleAll([
      adminUsers.requestDeletionByAdmin(actor, user.id, 'under_age', {
        correlationId: `b1-b-${round}`,
      }),
      anonymizeJob.process({ requestId: request.id }),
    ]);

    const label = `B round ${round}`;
    for (const outcome of [adminOutcome, workerOutcome]) {
      if (outcome.status === 'rejected' && isLockFault(outcome.reason)) {
        check(
          `${label} no deadlock/lock timeout`,
          false,
          refusalOf(outcome.reason).message,
        );
        return;
      }
    }

    check(
      `${label} worker anonymizes`,
      workerOutcome.status === 'fulfilled' && workerOutcome.value === true,
      workerOutcome.status === 'rejected'
        ? refusalOf(workerOutcome.reason).message
        : String(workerOutcome.value),
    );

    const userRow = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { status: true, email: true, name: true },
    });
    check(
      `${label} account anonymized exactly once`,
      userRow.status === 'anonymized' &&
        userRow.email === `deleted+${user.id}@anonymized.invalid` &&
        userRow.name === null,
      JSON.stringify(userRow),
    );

    const requestRow = await prisma.accountDeletionRequest.findUniqueOrThrow({
      where: { id: request.id },
      select: { status: true },
    });
    check(
      `${label} request completed`,
      requestRow.status === 'completed',
      requestRow.status,
    );

    const anonymizedAudits = await prisma.auditLog.count({
      where: { action: 'account.anonymized', targetId: String(user.id) },
    });
    check(
      `${label} one anonymization audit row`,
      anonymizedAudits === 1,
      `audits: ${anonymizedAudits}`,
    );

    if (adminOutcome.status === 'rejected') {
      const refusal = refusalOf(adminOutcome.reason);
      // The row is due when the admin reads it, so a normal refusal is the
      // already-due 409. If the worker committed first the user is anonymized
      // and `lockUser` answers with the not-found 404 — a different status, not
      // a 409 with a "not found" code.
      const alreadyDue =
        refusal.httpStatus === 409 &&
        refusal.code === 'USER_DELETION_ALREADY_DUE';
      const alreadyAnonymized =
        refusal.httpStatus === 404 && refusal.code === 'USER_NOT_FOUND';
      check(
        `${label} admin refusal is already-due (409) or anonymized (404)`,
        alreadyDue || alreadyAnonymized,
        JSON.stringify(refusal),
      );
    } else {
      // The admin read the row before anonymization committed: it is not due?
      // No — the row is due, so the service must have refused. A fulfilled call
      // would mean the service accepted a due request.
      check(
        `${label} admin does not accept a due request`,
        false,
        'admin request fulfilled on a due request',
      );
    }
  }
}

async function runScenarioC(adminA: number, adminB: number): Promise<void> {
  console.log(
    `\n== Scenario C: two admins on the same user (${ROUNDS} rounds)`,
  );

  for (let round = 1; round <= ROUNDS; round += 1) {
    const user = await createUser(`c${round}`);
    jobQueue.clear();

    const [first, second] = await settleAll([
      adminUsers.requestDeletionByAdmin(
        { id: adminA, role: 'admin' },
        user.id,
        'under_age',
        { correlationId: `b1-c1-${round}` },
      ),
      adminUsers.requestDeletionByAdmin(
        { id: adminB, role: 'admin' },
        user.id,
        'under_age',
        { correlationId: `b1-c2-${round}` },
      ),
    ]);

    const label = `C round ${round}`;
    for (const outcome of [first, second]) {
      if (outcome.status === 'rejected' && isLockFault(outcome.reason)) {
        check(
          `${label} no deadlock/lock timeout`,
          false,
          refusalOf(outcome.reason).message,
        );
        return;
      }
      if (outcome.status === 'rejected' && isUniqueViolation(outcome.reason)) {
        check(
          `${label} no unique violation`,
          false,
          refusalOf(outcome.reason).message,
        );
        return;
      }
    }

    check(
      `${label} both calls succeed`,
      first.status === 'fulfilled' && second.status === 'fulfilled',
      JSON.stringify([first, second]),
    );

    const requested = await prisma.accountDeletionRequest.findMany({
      where: { userId: user.id, status: 'requested' },
      select: { id: true },
    });
    check(
      `${label} exactly one requested row`,
      requested.length === 1,
      JSON.stringify(requested),
    );

    const firstId =
      first.status === 'fulfilled'
        ? (first.value as { requestId: number }).requestId
        : null;
    const secondId =
      second.status === 'fulfilled'
        ? (second.value as { requestId: number }).requestId
        : null;
    check(
      `${label} both calls answer the same request`,
      firstId !== null && firstId === secondId && firstId === requested[0]?.id,
      JSON.stringify({ firstId, secondId, requested }),
    );

    const audits = await prisma.auditLog.count({
      where: {
        action: 'account.deletion_requested_by_admin',
        targetId: String(user.id),
      },
    });
    check(`${label} exactly one audit row`, audits === 1, `audits: ${audits}`);

    const jobs = jobQueue
      .getJobs()
      .filter(
        (job) =>
          job.name === 'privacy.anonymize-account' ||
          job.name === 'mail.account-deletion-scheduled',
      );
    check(
      `${label} one anonymize + one mail job`,
      jobs.length === 2,
      JSON.stringify(jobs.map((job) => job.options?.singletonKey)),
    );
  }
}

async function runScenarioD(adminId: number): Promise<void> {
  console.log(
    `\n== Scenario D: self-service request || admin request (${ROUNDS} rounds)`,
  );
  const actor = { id: adminId, role: 'admin' };

  for (let round = 1; round <= ROUNDS; round += 1) {
    const user = await createUser(`d${round}`);
    jobQueue.clear();

    const [selfOutcome, adminOutcome] = await settleAll([
      selfDeletionRequest(user.id),
      adminUsers.requestDeletionByAdmin(actor, user.id, 'under_age', {
        correlationId: `b1-d-${round}`,
      }),
    ]);

    const label = `D round ${round}`;
    for (const outcome of [selfOutcome, adminOutcome]) {
      if (outcome.status === 'rejected' && isLockFault(outcome.reason)) {
        check(
          `${label} no deadlock/lock timeout`,
          false,
          refusalOf(outcome.reason).message,
        );
        return;
      }
      if (outcome.status === 'rejected' && isUniqueViolation(outcome.reason)) {
        check(
          `${label} no unique violation`,
          false,
          refusalOf(outcome.reason).message,
        );
        return;
      }
    }

    check(
      `${label} self-service call succeeds`,
      selfOutcome.status === 'fulfilled',
      selfOutcome.status === 'rejected'
        ? refusalOf(selfOutcome.reason).message
        : 'ok',
    );
    check(
      `${label} admin call succeeds`,
      adminOutcome.status === 'fulfilled',
      adminOutcome.status === 'rejected'
        ? refusalOf(adminOutcome.reason).message
        : 'ok',
    );

    const rows = await prisma.accountDeletionRequest.findMany({
      where: { userId: user.id },
      select: { id: true, status: true, initiatedBy: true },
    });
    check(
      `${label} exactly one request row`,
      rows.length === 1,
      JSON.stringify(rows),
    );
    check(
      `${label} one requested row owned by admin`,
      rows.filter((row) => row.status === 'requested').length === 1 &&
        rows[0]?.initiatedBy === 'admin',
      JSON.stringify(rows),
    );

    const adminRequestId =
      adminOutcome.status === 'fulfilled'
        ? (adminOutcome.value as { requestId: number }).requestId
        : null;
    check(
      `${label} admin answers the surviving row`,
      adminRequestId === rows[0]?.id,
      JSON.stringify({ adminRequestId, rows }),
    );

    const userRow = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { status: true },
    });
    check(
      `${label} user ends deletion_pending`,
      userRow.status === 'deletion_pending',
      userRow.status,
    );

    const audits = await prisma.auditLog.count({
      where: {
        action: 'account.deletion_requested_by_admin',
        targetId: String(user.id),
      },
    });
    check(
      `${label} exactly one admin audit row`,
      audits === 1,
      `audits: ${audits}`,
    );
  }
}

async function main(): Promise<void> {
  await prisma.$connect();

  // The harness leaves `requested` rows behind and asserts on per-user counts,
  // so it is only meaningful on a fresh migration-only disposable database
  // (same precondition as run-admin-users-concurrency.ts).
  const existingRequests = await prisma.accountDeletionRequest.count();
  if (existingRequests !== 0) {
    failed = true;
    console.error(
      `FAIL precondition: expected a fresh database with no AccountDeletionRequest rows, found ${existingRequests}`,
    );
    return;
  }

  passwordHash = await hashPasswordWithPepper(PASSWORD, PEPPER);
  await authService.onModuleInit();

  const adminA = await createAdmin('admin_a');
  const adminB = await createAdmin('admin_b');

  await runScenarioA(adminA);
  await runScenarioB(adminA);
  await runScenarioC(adminA, adminB);
  await runScenarioD(adminA);

  if (jobQueue.getJobs().length > 0) {
    console.log(`note: ${jobQueue.getJobs().length} in-memory jobs recorded`);
  }
}

main()
  .catch((error: unknown) => {
    failed = true;
    const name = error instanceof Error ? error.constructor.name : 'value';
    console.error(`concurrency harness failed (${name})`);
    if (error instanceof Error) console.error(error.message);
  })
  .finally(async () => {
    await prisma.$disconnect();
    if (failed) process.exitCode = 1;
    console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
  });
