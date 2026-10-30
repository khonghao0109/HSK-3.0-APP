import { ForbiddenException, HttpException } from '@nestjs/common';

import { assertDisposableTestDatabase } from '../../src/common/utils/assert-disposable-test-database';
import { AdminUsersService } from '../../src/modules/admin-users/admin-users.service';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * M5.3 database races.
 *
 * TL-65: two active admins demote each other at the same time. The advisory
 * transaction lock serializes them so exactly one demotion commits and the
 * database keeps one active admin and one `user.role_changed` audit row.
 *
 * TL-76: the actor row is re-read under `FOR UPDATE` inside the same
 * transaction, so a caller demoted between RolesGuard and the mutation is
 * rejected with 403 and performs no write. Both scenarios are exercised:
 * a concurrent demotion/suspension race and a deterministic stale-actor call.
 */

type MutationOutcome = {
  status: 'fulfilled' | 'rejected';
  httpStatus: number | null;
  errorCode: string | null;
};

const ADMIN_USER_PREFIX = `m53_race_${Date.now()}`;
const CORRELATION_ID = `m53-race-correlation-${Date.now()}`;

const database = assertDisposableTestDatabase();
console.log(`database under test: ${database.databaseName}`);

const prisma = new PrismaService();
const service = new AdminUsersService(prisma);

let failed = false;

function check(label: string, condition: boolean, detail: string): void {
  if (condition) {
    console.log(`PASS ${label}`);
    return;
  }
  failed = true;
  console.error(`FAIL ${label}: ${detail}`);
}

function statusOf(error: unknown): number | null {
  return error instanceof HttpException ? error.getStatus() : null;
}

function codeOf(error: unknown): string | null {
  if (!(error instanceof HttpException)) return null;
  const response = error.getResponse();
  if (typeof response !== 'object' || response === null) return null;
  const code = (response as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

async function createAdmins(
  prefix: string,
  label: 'A' | 'B' | 'C',
): Promise<{ id: number; email: string }> {
  return prisma.user.create({
    data: {
      email: `${prefix}_${label.toLowerCase()}@example.test`,
      password: 'race-seed-hash',
      name: `Race Admin ${label}`,
      role: 'admin',
      status: 'active',
    },
    select: { id: true, email: true },
  });
}

async function runTwoAdminDemotionRace(): Promise<void> {
  const adminA = await createAdmins(ADMIN_USER_PREFIX, 'A');
  const adminB = await createAdmins(ADMIN_USER_PREFIX, 'B');

  const context = { correlationId: CORRELATION_ID };
  const results = await Promise.allSettled([
    service.changeRole(
      { id: adminA.id, role: 'admin' },
      adminB.id,
      'user',
      context,
    ),
    service.changeRole(
      { id: adminB.id, role: 'admin' },
      adminA.id,
      'user',
      context,
    ),
  ]);

  const outcomes = results.map((result) => summarize(result));
  console.log('demotion race outcomes:', JSON.stringify(outcomes));

  const winners = outcomes.filter((outcome) => outcome.status === 'fulfilled');
  const losers = outcomes.filter((outcome) => outcome.status === 'rejected');
  check(
    'exactly one demotion commits',
    winners.length === 1,
    String(winners.length),
  );
  check(
    'exactly one demotion is rejected',
    losers.length === 1,
    String(losers.length),
  );
  // TL-76: the losing caller was demoted by the winner, so the actor re-check
  // fails closed with 403 before the target is touched.
  check(
    'losing request is 403 FORBIDDEN (stale actor)',
    losers[0]?.httpStatus === 403 && losers[0]?.errorCode === 'FORBIDDEN',
    JSON.stringify(losers[0]),
  );

  const activeAdmins = await prisma.user.count({
    where: {
      email: { startsWith: ADMIN_USER_PREFIX },
      role: 'admin',
      status: 'active',
      deletedAt: null,
    },
  });
  check(
    'exactly one active admin remains',
    activeAdmins === 1,
    String(activeAdmins),
  );

  const users = await prisma.user.findMany({
    where: { email: { startsWith: ADMIN_USER_PREFIX } },
    select: { id: true, role: true },
    orderBy: { id: 'asc' },
  });
  check(
    'demoted admin is now role user',
    users.filter((user) => user.role === 'user').length === 1,
    JSON.stringify(users),
  );

  const audits = await prisma.auditLog.findMany({
    where: {
      action: 'user.role_changed',
      correlationId: CORRELATION_ID,
    },
    select: {
      actorId: true,
      targetId: true,
      beforeSummary: true,
      afterSummary: true,
    },
  });
  check(
    'exactly one audit row is written',
    audits.length === 1,
    String(audits.length),
  );
  check(
    'audit summaries only contain roles',
    audits[0] !== undefined &&
      JSON.stringify(audits[0].beforeSummary) ===
        JSON.stringify({ role: 'admin' }) &&
      JSON.stringify(audits[0].afterSummary) ===
        JSON.stringify({ role: 'user' }),
    JSON.stringify(audits),
  );
}

async function runStaleActorSuspensionRace(): Promise<void> {
  const prefix = `${ADMIN_USER_PREFIX}_race`;
  const adminA = await createAdmins(prefix, 'A');
  const adminB = await createAdmins(prefix, 'B');
  const adminC = await createAdmins(prefix, 'C');

  const context = { correlationId: `${CORRELATION_ID}-suspension` };
  const results = await Promise.allSettled([
    // A demotes B.
    service.changeRole(
      { id: adminA.id, role: 'admin' },
      adminB.id,
      'user',
      context,
    ),
    // B, whose guard-role was still admin when the request started, suspends C.
    service.suspend(
      { id: adminB.id, role: 'admin' },
      adminC.id,
      'Stale actor race',
      context,
    ),
  ]);
  const [demotion, suspension] = results.map((result) => summarize(result));
  console.log(
    'stale-actor suspension race outcomes:',
    JSON.stringify({ demotion, suspension }),
  );

  const adminBAfter = await prisma.user.findUniqueOrThrow({
    where: { id: adminB.id },
    select: { role: true },
  });
  const adminCAfter = await prisma.user.findUniqueOrThrow({
    where: { id: adminC.id },
    select: { status: true },
  });
  const suspendAudits = await prisma.auditLog.count({
    where: {
      action: 'user.suspended',
      targetId: String(adminC.id),
      correlationId: context.correlationId,
    },
  });

  const demotionAlwaysCommits = demotion.status === 'fulfilled';
  // (a) B's suspension commits before A demotes B.
  const suspensionWon =
    suspension.status === 'fulfilled' &&
    adminBAfter.role === 'user' &&
    adminCAfter.status === 'suspended' &&
    suspendAudits === 1;
  // (b) A commits first: B's stale actor is rejected with no write.
  const staleActorRejected =
    suspension.status === 'rejected' &&
    suspension.httpStatus === 403 &&
    suspension.errorCode === 'FORBIDDEN' &&
    adminBAfter.role === 'user' &&
    adminCAfter.status === 'active' &&
    suspendAudits === 0;

  check(
    'A demotes B in both accepted shapes',
    demotionAlwaysCommits,
    JSON.stringify(demotion),
  );
  check(
    'outcome is either B-first commit or stale-actor 403 with no suspension',
    suspensionWon || staleActorRejected,
    JSON.stringify({ suspension, adminBAfter, adminCAfter, suspendAudits }),
  );
  check(
    'C never ends suspended without the suspension audit row',
    adminCAfter.status !== 'suspended' || suspendAudits === 1,
    JSON.stringify({ status: adminCAfter.status, suspendAudits }),
  );
}

async function runDeterministicStaleActor(): Promise<void> {
  const prefix = `${ADMIN_USER_PREFIX}_stale`;
  await createAdmins(prefix, 'A');
  const adminB = await createAdmins(prefix, 'B');
  const adminC = await createAdmins(prefix, 'C');

  // Simulate the interleaving: B's guard already passed, then B is demoted.
  await prisma.user.update({
    where: { id: adminB.id },
    data: { role: 'user' },
  });
  const auditsBefore = await prisma.auditLog.count();
  const context = { correlationId: `${CORRELATION_ID}-deterministic` };

  let caught: unknown = null;
  try {
    await service.suspend(
      { id: adminB.id, role: 'admin' },
      adminC.id,
      'Stale actor deterministic',
      context,
    );
  } catch (error: unknown) {
    caught = error;
  }

  const adminCAfter = await prisma.user.findUniqueOrThrow({
    where: { id: adminC.id },
    select: { status: true },
  });
  const auditsAfter = await prisma.auditLog.count();
  const suspendAudits = await prisma.auditLog.count({
    where: {
      action: 'user.suspended',
      targetId: String(adminC.id),
      correlationId: context.correlationId,
    },
  });

  check(
    'deterministic stale actor gets ForbiddenException',
    caught instanceof ForbiddenException,
    caught instanceof Error ? caught.constructor.name : typeof caught,
  );
  check(
    'deterministic stale actor gets 403 FORBIDDEN',
    statusOf(caught) === 403 && codeOf(caught) === 'FORBIDDEN',
    JSON.stringify({ status: statusOf(caught), code: codeOf(caught) }),
  );
  check(
    'target stays active after the stale call',
    adminCAfter.status === 'active',
    adminCAfter.status,
  );
  check(
    'stale call writes no audit row',
    auditsAfter === auditsBefore && suspendAudits === 0,
    JSON.stringify({ auditsBefore, auditsAfter, suspendAudits }),
  );
}

function summarize(result: PromiseSettledResult<unknown>): MutationOutcome {
  if (result.status === 'fulfilled') {
    return { status: 'fulfilled', httpStatus: 200, errorCode: null };
  }
  return {
    status: 'rejected',
    httpStatus: statusOf(result.reason),
    errorCode: codeOf(result.reason),
  };
}

async function main(): Promise<void> {
  await prisma.$connect();

  // The "last active admin" rule is global, so the race is only meaningful on a
  // fresh disposable database created for this harness (see the runbook note in
  // the M5.3 report). Fail loudly instead of drawing a false conclusion.
  const existingAdmins = await prisma.user.count({
    where: { role: 'admin', status: 'active', deletedAt: null },
  });
  if (existingAdmins !== 0) {
    failed = true;
    console.error(
      `FAIL precondition: expected a fresh database with 0 active admins, found ${existingAdmins}`,
    );
    return;
  }

  await runTwoAdminDemotionRace();
  await runStaleActorSuspensionRace();
  await runDeterministicStaleActor();

  // AuditLog rows are immutable (database trigger) and this database is
  // disposable, so the harness leaves its rows for the caller to drop.
}

main()
  .catch((error: unknown) => {
    failed = true;
    const name = error instanceof Error ? error.constructor.name : 'value';
    console.error(`concurrency harness failed (${name})`);
  })
  .finally(async () => {
    await prisma.$disconnect();
    if (failed) process.exitCode = 1;
    console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
  });
