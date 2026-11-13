/// <reference types="jest" />

import { randomUUID } from 'node:crypto';

import {
  ContentStatus,
  LearningEventType,
  LearningPlanStatus,
  PrismaClient,
  Role,
} from '@prisma/client';

import {
  main,
  p0ProductMetrics,
  type MetricsRange,
} from '../scripts/analytics/p0-product-metrics';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

const SECOND = 1_000;
const HOUR = 3_600 * SECOND;
const DAY = 24 * HOUR;

/**
 * M2.8 (Q75, Q76, Q77). Every row is dated around a random day of years 1000–1999
 * so the suite counts only its own fixture, whatever else is in the DB.
 */
describe('P0 product metrics (M2.8) E2E', () => {
  let prisma: PrismaService;
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  // shortcut: a random day among ~365k in years 1000–1999; a rerun on the
  // same DB collides only if two fixtures land within ~250 days (~0.1%).
  const from = new Date(
    Date.UTC(1000, 0, 1) + Math.floor(Math.random() * 365_000) * DAY,
  );
  const at = (ms: number) => new Date(from.getTime() + ms);
  const range: MetricsRange = { from, to: at(30 * DAY), asOf: at(33 * DAY) };
  let levelId = 0;
  let priorLevel: {
    id: number;
    status: ContentStatus;
    publishedAt: Date | null;
    deletedAt: Date | null;
  } | null = null;
  const lessonIds: number[] = [];
  let l1 = 0;
  let l2 = 0;

  async function user(name: string, createdAt: Date, role: Role = 'user') {
    const created = await prisma.user.create({
      data: {
        email: `m28.${name}.${suffix}@example.test`,
        password: 'not-a-real-hash',
        role,
        createdAt,
      },
      select: { id: true },
    });
    return created.id;
  }

  async function event(
    userId: number,
    type: LearningEventType,
    lessonId: number,
    occurredAt: Date,
  ) {
    await prisma.learningEvent.create({
      data: {
        userId,
        type,
        lessonId,
        occurredAt,
        idempotencyKey: randomUUID(),
      },
    });
  }

  const startDate = new Date(Date.UTC(2026, 9, 1));

  async function goal(userId: number) {
    await prisma.userGoal.create({
      data: {
        userId,
        targetLevelId: levelId,
        targetBand: 4,
        dailyMinutes: 15,
        startDate,
      },
    });
  }

  async function plan(
    userId: number,
    status: LearningPlanStatus,
    createdAt: Date,
    lessonIds: number[],
  ) {
    await prisma.learningPlan.create({
      data: {
        userId,
        targetLevelId: levelId,
        targetBand: 4,
        startDate,
        status,
        createdAt,
        items: {
          create: lessonIds.map((lessonId, index) => ({
            lessonId,
            orderIndex: index + 1,
          })),
        },
      },
    });
  }

  beforeAll(async () => {
    assertDisposableTestDatabase();
    prisma = new PrismaService();
    const published = { status: 'published' as const, publishedAt: new Date() };
    // Level codes are fixed (Level_code_band_check): borrow HSK4 (other suites upsert it), restore it after.
    priorLevel = await prisma.level.findUnique({
      where: { code: 'HSK4' },
      select: { id: true, status: true, publishedAt: true, deletedAt: true },
    });
    levelId = priorLevel
      ? (
          await prisma.level.update({
            where: { id: priorLevel.id },
            data: {
              status: 'published',
              publishedAt: priorLevel.publishedAt ?? new Date(),
              deletedAt: null,
            },
            select: { id: true },
          })
        ).id
      : (
          await prisma.level.create({
            data: {
              code: 'HSK4',
              name: 'HSK 4',
              orderIndex: 4,
              minBand: 4,
              maxBand: 4,
              ...published,
            },
            select: { id: true },
          })
        ).id;
    const base = -(1_000_000 + Math.floor(Math.random() * 1_000_000)) * 10;
    for (const offset of [0, 1]) {
      const lesson = await prisma.lesson.create({
        data: {
          levelId,
          orderIndex: base + offset,
          slug: `m28-${suffix}-${offset}`,
          title: `M2.8 lesson ${offset}`,
          ...published,
        },
        select: { id: true },
      });
      await prisma.topic.create({
        data: {
          lessonId: lesson.id,
          orderIndex: 1,
          title: 'M2.8 topic',
          content: [{ type: 'text', value: 'M2.8 fixture.' }],
          ...published,
        },
      });
      lessonIds.push(lesson.id);
    }
    [l1, l2] = lessonIds;
    // Onboarded (Q77): an active plan listing only l1, though l2 is ready
    // too, so the plan no longer matches the level. Activated by the
    // completion at +7 days − 1 s; the second completion of the same lesson
    // (+8 days) is outside the window and counts as one pair.
    const uFrom = await user('from', from);
    await goal(uFrom);
    await plan(uFrom, 'active', at(DAY), [l1]);
    await event(uFrom, 'lesson_started', l1, at(HOUR));
    await event(uFrom, 'lesson_completed', l1, at(7 * DAY - SECOND));
    await event(uFrom, 'lesson_completed', l1, at(8 * DAY));
    await event(uFrom, 'lesson_started', l2, at(DAY));
    await event(uFrom, 'lesson_completed', l2, at(34 * DAY)); // after asOf

    await user('to', range.to); // created at `to`: outside the cohort

    const admin = await user('admin', at(DAY), 'admin');
    await event(admin, 'lesson_started', l1, at(2 * DAY));
    await event(admin, 'lesson_completed', l1, at(2 * DAY + HOUR));

    // Completion exactly at createdAt + 7 days: not activated. Onboarded
    // through a plan that is now cancelled.
    const uEdge = await user('edge', at(2 * DAY));
    await plan(uEdge, 'cancelled', at(3 * DAY), [l1, l2]);
    await event(uEdge, 'lesson_completed', l1, at(9 * DAY));

    // In the cohort, but createdAt + 7 days is after asOf.
    const uLate = await user('late', at(28 * DAY));
    await event(uLate, 'lesson_started', l1, at(28 * DAY + 30 * 60 * SECOND));
    await event(uLate, 'lesson_completed', l1, at(28 * DAY + HOUR));

    const uStartOnly = await user('start-only', at(3 * DAY));
    await goal(uStartOnly); // a goal but no plan: not onboarded
    await event(uStartOnly, 'lesson_started', l2, at(4 * DAY));

    // Signed up before `from`; completed l1 before `from`, started l2 in the
    // range and completed it after `to` but before asOf.
    const uBefore = await user('before', at(-10 * DAY));
    await plan(uBefore, 'active', at(-5 * DAY), [l1]); // outside the cohort
    await event(uBefore, 'lesson_completed', l1, at(-DAY));
    await event(uBefore, 'lesson_started', l2, at(5 * DAY));
    await event(uBefore, 'lesson_completed', l2, at(31 * DAY));

    // Edges: createdAt + 7 days exactly at asOf (eligible); its plan is
    // created exactly at asOf (not onboarded). Events exactly at `from` and
    // `to`, and a completion exactly at asOf.
    const uExact = await user('exact', at(26 * DAY));
    await plan(uExact, 'active', range.asOf, [l1, l2]);
    await event(uEdge, 'lesson_started', l2, from);
    await event(uEdge, 'lesson_completed', l2, range.asOf);
    await event(uStartOnly, 'lesson_started', l1, range.to);
    await event(uLate, 'lesson_completed', l2, range.to);

    // Anonymized the way AnonymizeAccountJob leaves a User row.
    const uAnon = await user('anon', at(5 * DAY));
    await prisma.user.update({
      where: { id: uAnon },
      data: {
        email: `deleted+${uAnon}@anonymized.invalid`,
        name: null,
        status: 'anonymized',
      },
    });
  });

  afterAll(async () => {
    // Events are immutable, so the fixture stays; hide its lessons and put
    // HSK4 back the way it was.
    await prisma.lesson.updateMany({
      where: { id: { in: lessonIds } },
      data: { status: 'draft', deletedAt: new Date() },
    });
    await prisma.level.update({
      where: { id: levelId },
      data: priorLevel
        ? {
            status: priorLevel.status,
            publishedAt: priorLevel.publishedAt,
            deletedAt: priorLevel.deletedAt,
          }
        : { status: 'draft', deletedAt: new Date() },
    });
    await prisma.$disconnect();
  });

  // Worked out by hand from the fixture above.
  const expected = {
    signups: 6, // from, edge, late, start-only, anon, exact
    onboarded: 2, // from (stale active plan), edge (cancelled plan); not exact (plan at asOf), start-only (goal only), late, anon (none)
    activationEligible: 5, // late is not; exact is, at +7 d == asOf
    activated: 1, // from (+7 d − 1 s); edge is at +7 d
    activationRate: 0.2,
    lessonsStarted: 6, // from·l1, from·l2, late·l1, start-only·l2, before·l2, edge·l2 (at from)
    lessonsCompleted: 3, // from·l1, edge·l1, late·l1 (late·l2 is at `to`)
    lessonCompletionRate: 0.5, // from·l1, late·l1, before·l2; edge·l2 is at asOf
    completingLearners: 3,
  };

  it('counts the fixture as worked out by hand', async () => {
    await expect(p0ProductMetrics(prisma, range)).resolves.toEqual(expected);
  });

  it('gives the same counts when the session runs in Asia/Ho_Chi_Minh', async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    url.searchParams.set('options', '-c TimeZone=Asia/Ho_Chi_Minh');
    const local = new PrismaClient({
      datasources: { db: { url: url.toString() } },
    });
    try {
      const [{ timeZone }] = await local.$queryRaw<Array<{ timeZone: string }>>`
        SELECT current_setting('TimeZone') AS "timeZone"
      `;
      expect(timeZone).toBe('Asia/Ho_Chi_Minh');
      await expect(p0ProductMetrics(local, range)).resolves.toEqual(expected);
    } finally {
      await local.$disconnect();
    }
  });

  it('returns null rates for an empty range', async () => {
    await expect(
      p0ProductMetrics(prisma, {
        from: at(-200 * DAY),
        to: at(-100 * DAY),
        asOf: at(-50 * DAY),
      }),
    ).resolves.toEqual({
      signups: 0,
      onboarded: 0,
      activationEligible: 0,
      activated: 0,
      activationRate: null,
      lessonsStarted: 0,
      lessonsCompleted: 0,
      lessonCompletionRate: null,
      completingLearners: 0,
    });
  });

  it.each([
    [
      'from >= to',
      ['--from', '2026-02-01T00:00:00Z', '--to', '2026-01-01T00:00:00Z'],
    ],
    [
      'to > as-of',
      [
        '--from',
        '2026-01-01T00:00:00Z',
        '--to',
        '2026-03-01T00:00:00Z',
        '--as-of',
        '2026-02-01T00:00:00Z',
      ],
    ],
    [
      'an invalid date',
      ['--from', '2026-13-01T00:00:00Z', '--to', '2026-02-01T00:00:00Z'],
    ],
    [
      'a time without offset',
      ['--from', '2026-01-01T00:00:00', '--to', '2026-02-01T00:00:00Z'],
    ],
    ['a missing --to', ['--from', '2026-01-01T00:00:00Z']],
  ])(
    'main() exits non-zero without touching the DB on %s',
    async (_name, argv) => {
      const createClient = jest.fn(() => prisma);
      const stderr = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);
      try {
        await expect(main(argv, createClient)).resolves.not.toBe(0);
        expect(createClient).not.toHaveBeenCalled();
      } finally {
        stderr.mockRestore();
      }
    },
  );
});
