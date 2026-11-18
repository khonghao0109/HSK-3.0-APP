/**
 * P0 product metrics (M2.8, Q75, Q76, Q77) from first-party tables only:
 * `User`, `LearningPlan`, `LearningEvent`. Aggregate counts,
 * never a row, id or email. Definitions: docs/analytics/P0_PRODUCT_METRICS.md.
 *
 *   npm run analytics:p0 -- --from 2026-10-01T00:00:00Z --to 2026-11-01T00:00:00Z [--as-of …]
 */
import { Prisma, PrismaClient } from '@prisma/client';

import { PrismaService } from '../../src/prisma/prisma.service';

export type MetricsRange = { from: Date; to: Date; asOf: Date };

export type P0ProductMetrics = {
  signups: number;
  onboarded: number;
  activationEligible: number;
  activated: number;
  activationRate: number | null;
  lessonsStarted: number;
  lessonsCompleted: number;
  lessonCompletionRate: number | null;
  completingLearners: number;
};

// Columns are `timestamp` holding UTC wall time. Converting an ISO instant
// with AT TIME ZONE 'UTC' compares correctly whatever the session TimeZone is.
function utc(date: Date): Prisma.Sql {
  return Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0
    ? null
    : Math.round((numerator / denominator) * 10_000) / 10_000;
}

type CohortRow = {
  signups: number;
  onboarded: number;
  activationEligible: number;
  activated: number;
};

type LessonRow = {
  lessonsStarted: number;
  lessonsCompleted: number;
  startedAndCompleted: number;
  completingLearners: number;
};

export async function p0ProductMetrics(
  prisma: PrismaClient,
  range: MetricsRange,
): Promise<P0ProductMetrics> {
  const from = utc(range.from);
  const to = utc(range.to);
  const asOf = utc(range.asOf);

  const [cohort, lessons] = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;

    // Q77: onboarded = has ever created a LearningPlan (any status; plans are
    // cancelled, never deleted) before asOf, so the count only grows.
    const [cohortRow] = await tx.$queryRaw<CohortRow[]>`
      WITH cohort AS (
        SELECT u.id, u."createdAt"
        FROM "User" u
        WHERE u.role = 'user' AND u."createdAt" >= ${from} AND u."createdAt" < ${to}
      )
      SELECT
        (SELECT count(*) FROM cohort)::int AS "signups",
        count(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM "LearningPlan" p
            WHERE p."userId" = c.id AND p."createdAt" < ${asOf}
          )
        )::int AS "onboarded",
        count(*) FILTER (WHERE c."createdAt" + interval '7 days' <= ${asOf})::int AS "activationEligible",
        count(*) FILTER (
          WHERE c."createdAt" + interval '7 days' <= ${asOf}
            AND EXISTS (
              SELECT 1 FROM "LearningEvent" e
              WHERE e."userId" = c.id AND e.type = 'lesson_completed'
                AND e."occurredAt" >= c."createdAt"
                AND e."occurredAt" < c."createdAt" + interval '7 days'
            )
        )::int AS "activated"
      FROM cohort c
    `;

    const [lessonRow] = await tx.$queryRaw<LessonRow[]>`
      WITH learner_events AS (
        SELECT e."userId", e."lessonId", e.type, e."occurredAt"
        FROM "LearningEvent" e
        JOIN "User" u ON u.id = e."userId" AND u.role = 'user'
        WHERE e."lessonId" IS NOT NULL
          AND e.type IN ('lesson_started', 'lesson_completed')
      ),
      started AS (
        SELECT DISTINCT "userId", "lessonId" FROM learner_events
        WHERE type = 'lesson_started' AND "occurredAt" >= ${from} AND "occurredAt" < ${to}
      ),
      completed AS (
        SELECT DISTINCT "userId", "lessonId" FROM learner_events
        WHERE type = 'lesson_completed' AND "occurredAt" >= ${from} AND "occurredAt" < ${to}
      )
      SELECT
        (SELECT count(*) FROM started)::int AS "lessonsStarted",
        (SELECT count(*) FROM completed)::int AS "lessonsCompleted",
        (
          SELECT count(*) FROM started s
          WHERE EXISTS (
            SELECT 1 FROM learner_events e
            WHERE e."userId" = s."userId" AND e."lessonId" = s."lessonId"
              AND e.type = 'lesson_completed' AND e."occurredAt" < ${asOf}
          )
        )::int AS "startedAndCompleted",
        (SELECT count(DISTINCT "userId") FROM completed)::int AS "completingLearners"
    `;

    return [cohortRow, lessonRow];
  });

  return {
    signups: cohort.signups,
    onboarded: cohort.onboarded,
    activationEligible: cohort.activationEligible,
    activated: cohort.activated,
    activationRate: rate(cohort.activated, cohort.activationEligible),
    lessonsStarted: lessons.lessonsStarted,
    lessonsCompleted: lessons.lessonsCompleted,
    lessonCompletionRate: rate(
      lessons.startedAndCompleted,
      lessons.lessonsStarted,
    ),
    completingLearners: lessons.completingLearners,
  };
}

// ISO 8601 with Z or an explicit offset: a bare local time would depend on
// the machine's time zone.
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/u;

function readInstant(argv: string[], name: string): Date | null | undefined {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = argv[index + 1] ?? '';
  if (!ISO_INSTANT.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseRange(argv: string[], now: Date): MetricsRange | string {
  const from = readInstant(argv, 'from');
  const to = readInstant(argv, 'to');
  const asOf = readInstant(argv, 'as-of');
  if (!from || !to || asOf === null) {
    return '--from and --to are required; --from, --to and --as-of must be ISO 8601 with Z or an offset';
  }
  const range = { from, to, asOf: asOf ?? now };
  if (!(range.from < range.to && range.to <= range.asOf)) {
    return 'expected --from < --to <= --as-of';
  }
  return range;
}

export async function main(
  argv: string[],
  createClient: () => PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const range = parseRange(argv, now);
  if (typeof range === 'string') {
    process.stderr.write(`analytics:p0: ${range}\n`);
    return 2;
  }
  const prisma = createClient();
  try {
    const metrics = await p0ProductMetrics(prisma, range);
    process.stdout.write(
      `${JSON.stringify(
        {
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          asOf: range.asOf.toISOString(),
          ...metrics,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main(process.argv.slice(2), () => new PrismaService())
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `analytics:p0: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
