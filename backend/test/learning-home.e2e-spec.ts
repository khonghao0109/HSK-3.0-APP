/// <reference types="jest" />

import { randomInt, randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { LearningEventType } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { LearningHomeService } from '../src/modules/learning/home/learning-home.service';
import { validateTimezone } from '../src/modules/user/validation/user-profile.validator';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

type LevelState = {
  status: 'draft' | 'published' | 'archived';
  publishedAt: Date | null;
  deletedAt: Date | null;
};

/** 12:00 in Asia/Ho_Chi_Minh (UTC+7) on 2026-10-07. */
const NOW = new Date('2026-10-07T05:00:00Z');

/**
 * Home summary (Q13). Most cases call the service with a fixed `now`; [E1]
 * and [E9] go through HTTP. Every case uses its own learner. The suite's
 * lesson lives in HSK7_9 (the shared activity level) and is withdrawn in
 * `afterAll`, so path suites over HSK2/HSK3 are not affected.
 */
describe('Learning home summary (Q13) E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let home: LearningHomeService;
  let levelId: number;
  let lessonId: number;
  let topicId: number;
  let exerciseId: number;
  let priorLevel: LevelState | null = null;
  let attemptNumber = 0;
  let eventNumber = 0;

  const suffix = randomUUID();
  const password = 'StrongPassword123!';

  beforeAll(async () => {
    assertDisposableTestDatabase();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        exceptionFactory: createSafeValidationException,
      }),
    );
    await app.init();
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    home = app.get(LearningHomeService);

    const prior = await prisma.level.findUnique({
      where: { code: 'HSK7_9' },
      select: { status: true, publishedAt: true, deletedAt: true },
    });
    priorLevel = prior;
    levelId = (
      await prisma.level.upsert({
        where: { code: 'HSK7_9' },
        update: {
          status: 'published',
          publishedAt: new Date(),
          deletedAt: null,
        },
        create: {
          code: 'HSK7_9',
          name: 'HSK 7-9',
          orderIndex: 7,
          minBand: 7,
          maxBand: 9,
          status: 'published',
          publishedAt: new Date(),
        },
        select: { id: true },
      })
    ).id;

    const lesson = await prisma.lesson.create({
      data: {
        levelId,
        title: 'Home lesson',
        orderIndex: randomInt(100_000, 1_000_000),
        slug: `home-lesson-${suffix}`,
        status: 'published',
        publishedAt: new Date(),
        topics: {
          create: {
            title: 'Home topic',
            content: [{ type: 'text', value: 'Home summary.' }],
            orderIndex: 1,
            status: 'published',
            publishedAt: new Date(),
          },
        },
      },
      select: { id: true, topics: { select: { id: true } } },
    });
    lessonId = lesson.id;
    topicId = lesson.topics[0].id;
    exerciseId = (
      await prisma.lessonExercise.create({
        data: {
          lessonId,
          topicId,
          type: 'mcq',
          prompt: 'Choose the greeting',
          content: {
            options: [
              { id: 'hello', text: '你好' },
              { id: 'bye', text: '再见' },
            ],
          },
          answer: { optionId: 'hello' },
          orderIndex: 1,
          status: 'published',
          publishedAt: new Date(),
        },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    if (!app) return;
    if (lessonId === undefined) {
      await app.close();
      return;
    }
    await prisma.lesson.update({
      where: { id: lessonId },
      data: { status: 'archived', deletedAt: new Date() },
    });
    await prisma.level.update({
      where: { id: levelId },
      data: priorLevel ?? {
        status: 'draft',
        publishedAt: null,
        deletedAt: null,
      },
    });
    await app.close();
  });

  it('[E1] rejects the home summary without a JWT', async () => {
    await request(app.getHttpServer()).get('/api/v1/learning/home').expect(401);
  });

  it('[E2] summarises a new learner without goal, profile or events', async () => {
    const userId = await createUser('e2', 'Lan');
    await expect(summary(userId)).resolves.toEqual({
      nextStep: 'set_goal',
      greetingName: 'Lan',
      dailyGoal: null,
      streakDays: 0,
      continueLesson: null,
    });
  });

  it('[E3] greets with the trimmed displayName, else a valid account name, else null', async () => {
    const trimmed = await createUser('e3-trimmed', 'Account');
    await addProfile(trimmed, { displayName: '  Minh  ' });
    expect((await summary(trimmed)).greetingName).toBe('Minh');

    const blank = await createUser('e3-blank', ' Lan ');
    await addProfile(blank, { displayName: '   ' });
    expect((await summary(blank)).greetingName).toBe('Lan');

    const control = await createUser('e3-control', 'Lan\u0007');
    await addProfile(control, { displayName: '   ' });
    expect((await summary(control)).greetingName).toBeNull();

    const nameless = await createUser('e3-nameless', null);
    expect((await summary(nameless)).greetingName).toBeNull();
  });

  it('[E4] sums only the learner submitted minutes of the local day up to now', async () => {
    const userId = await createUser('e4', 'Lan');
    await addProfile(userId, { timezone: 'Asia/Ho_Chi_Minh' });
    await addGoal(userId, 15);
    await seedMinutesDay(userId, await createUser('e4-other', 'Other'));

    expect((await summary(userId)).dailyGoal).toEqual({
      targetMinutes: 15,
      minutesToday: 7,
    });
  });

  it('[E5] uses the profile timezone for the same attempts', async () => {
    const userId = await createUser('e5', 'Lan');
    await addProfile(userId, { timezone: 'UTC' });
    await addGoal(userId, 15);
    await seedMinutesDay(userId, await createUser('e5-other', 'Other'));

    expect((await summary(userId)).dailyGoal).toEqual({
      targetMinutes: 15,
      minutesToday: 5,
    });
  });

  it('[E6] counts consecutive local learning days from completions and submissions', async () => {
    const broken = await createUser('e6-broken', 'Lan');
    for (const day of ['07', '06', '05', '03']) {
      await addEvent(broken, 'lesson_completed', localTime(day, '09:00'));
    }
    // Several qualifying events on one local day still count that day once.
    await addEvent(broken, 'topic_completed', localTime('07', '10:00'));
    await addEvent(broken, 'topic_completed', localTime('05', '10:00'));
    expect((await summary(broken)).streakDays).toBe(3);

    const yesterday = await createUser('e6-yesterday', 'Lan');
    for (const day of ['06', '05']) {
      await addEvent(yesterday, 'lesson_completed', localTime(day, '09:00'));
    }
    expect((await summary(yesterday)).streakDays).toBe(2);

    const ignored = await createUser('e6-ignored', 'Lan');
    await addEvent(ignored, 'word_saved', localTime('07', '08:00'));
    await addEvent(ignored, 'lesson_started', localTime('07', '08:30'));
    await addEvent(ignored, 'topic_completed', localTime('06', '09:00'));
    expect((await summary(ignored)).streakDays).toBe(1);

    const submitted = await createUser('e6-submitted', 'Lan');
    const attemptId = await addAttempt(submitted, localTime('07', '08:00'), 60);
    await addEvent(
      submitted,
      'exercise_submitted',
      localTime('07', '08:00'),
      attemptId,
    );
    expect((await summary(submitted)).streakDays).toBe(1);
  });

  it('[E7] buckets days in Pacific/Kiritimati (UTC+14)', async () => {
    const now = new Date('2026-10-06T12:00:00Z');
    const today = await createUser('e7-today', 'Lan');
    await addProfile(today, { timezone: 'Pacific/Kiritimati' });
    // 00:30 local on 2026-10-07, still 2026-10-06 in UTC.
    await addEvent(today, 'lesson_completed', new Date('2026-10-06T10:30:00Z'));
    expect((await summary(today, now)).streakDays).toBe(1);

    const broken = await createUser('e7-broken', 'Lan');
    await addProfile(broken, { timezone: 'Pacific/Kiritimati' });
    // 23:00 local on 2026-10-05: the day before yesterday in Kiritimati,
    // although it is yesterday in UTC.
    await addEvent(
      broken,
      'lesson_completed',
      new Date('2026-10-05T09:00:00Z'),
    );
    expect((await summary(broken, now)).streakDays).toBe(0);
  });

  it('[E8] ignores events after now and keeps one at now', async () => {
    const later = await createUser('e8-later', 'Lan');
    await addEvent(later, 'lesson_completed', new Date('2026-10-07T06:00:00Z'));
    expect((await summary(later)).streakDays).toBe(0);

    const atNow = await createUser('e8-at-now', 'Lan');
    await addEvent(atNow, 'lesson_completed', NOW);
    expect((await summary(atNow)).streakDays).toBe(1);
  });

  it('[E9] matches the path nextLesson over HTTP without writing', async () => {
    const learner = await register('e9');
    await prisma.progress.create({
      data: {
        userId: learner.userId,
        lessonId,
        status: 'learning',
        completionPercent: 40,
        startedAt: new Date(),
        lastActivityAt: new Date(),
      },
    });

    const counts = () =>
      Promise.all([
        prisma.progress.count(),
        prisma.learningEvent.count(),
        prisma.lessonExerciseAttempt.count(),
      ]);
    const before = await counts();
    const homeResponse = await request(app.getHttpServer())
      .get('/api/v1/learning/home')
      .set('Authorization', `Bearer ${learner.token}`)
      .expect(200);
    const pathResponse = await request(app.getHttpServer())
      .get('/api/v1/learning/path')
      .set('Authorization', `Bearer ${learner.token}`)
      .expect(200);
    const after = await counts();

    expect(after).toEqual(before);
    expect(homeResponse.headers['cache-control']).toBe('no-store');
    const nextLesson = pathResponse.body.data.nextLesson;
    expect(nextLesson).toMatchObject({ lessonId, levelCode: 'HSK7_9' });
    expect(homeResponse.body.data.continueLesson).toEqual({
      ...nextLesson,
      completionPercent: 40,
    });
  });

  it('[E10] caps minutesToday at 1440', async () => {
    const userId = await createUser('e10', 'Lan');
    await addGoal(userId, 30);
    await addAttempt(userId, new Date('2026-10-07T01:00:00Z'), 86_400);
    await addAttempt(userId, new Date('2026-10-07T02:00:00Z'), 86_400);

    expect((await summary(userId)).dailyGoal).toEqual({
      targetMinutes: 30,
      minutesToday: 1440,
    });
  });

  it('[E11] falls back to the default timezone for an invalid stored timezone', async () => {
    const learner = await register('e11');
    await addProfile(learner.userId, { timezone: 'Mars/Base' });
    await addGoal(learner.userId, 15);
    // 00:30 on 2026-10-07 in Asia/Ho_Chi_Minh, still 2026-10-06 in UTC.
    await addAttempt(learner.userId, new Date('2026-10-06T17:30:00Z'), 125);

    await request(app.getHttpServer())
      .get('/api/v1/learning/home')
      .set('Authorization', `Bearer ${learner.token}`)
      .expect(200);
    expect((await summary(learner.userId)).dailyGoal).toEqual({
      targetMinutes: 15,
      minutesToday: 2,
    });
  });

  it('[E12] falls back to the default timezone when PostgreSQL rejects a timezone Node accepts', async () => {
    // Preconditions: the zone passes the Node validator but PostgreSQL does
    // not know it, so the fallback path is really exercised.
    expect(validateTimezone('US/Pacific-New').valid).toBe(true);
    await expect(
      prisma.$queryRaw`SELECT now() AT TIME ZONE ${'US/Pacific-New'}::text`,
    ).rejects.toMatchObject({ code: 'P2010', meta: { code: '22023' } });

    const learner = await register('e12');
    await addProfile(learner.userId, { timezone: 'US/Pacific-New' });
    await addGoal(learner.userId, 15);
    // 00:30 on 2026-10-07 in Asia/Ho_Chi_Minh: today, floor(125 / 60) = 2.
    await addAttempt(learner.userId, new Date('2026-10-06T17:30:00Z'), 125);
    // 00:30 on 2026-10-06 in Asia/Ho_Chi_Minh: yesterday, so the run of one
    // day still counts. The attempt above is not a learning event, so the
    // 7th is not a learning day: streakDays = 1. With UTC instead, the event
    // falls on the 5th (two days before the 7th) and the attempt outside
    // today, giving 0 and 0.
    await addEvent(
      learner.userId,
      'lesson_completed',
      new Date('2026-10-05T17:30:00Z'),
    );

    const data = await summary(learner.userId);
    expect(data.dailyGoal).toEqual({ targetMinutes: 15, minutesToday: 2 });
    expect(data.streakDays).toBe(1);

    await request(app.getHttpServer())
      .get('/api/v1/learning/home')
      .set('Authorization', `Bearer ${learner.token}`)
      .expect(200);
  });

  it('[E13] counts the most recent run, not the longest one', async () => {
    const userId = await createUser('e13', 'Lan');
    for (const day of ['01', '02', '03', '04', '06', '07']) {
      await addEvent(userId, 'lesson_completed', localTime(day, '09:00'));
    }
    expect((await summary(userId)).streakDays).toBe(2);
  });

  it('[E14] starts the local day at midnight on a DST change day', async () => {
    // 2026-11-01 in America/New_York: EDT (UTC-4) until 06:00Z, then EST.
    const now = new Date('2026-11-01T15:00:00Z');
    const userId = await createUser('e14', 'Lan');
    await addProfile(userId, { timezone: 'America/New_York' });
    await addGoal(userId, 15);
    // 00:30 EDT on 1 November: counts.
    await addAttempt(userId, new Date('2026-11-01T04:30:00Z'), 120);
    // 23:30 EDT on 31 October: does not count.
    await addAttempt(userId, new Date('2026-11-01T03:30:00Z'), 60);

    expect((await summary(userId, now)).dailyGoal).toEqual({
      targetMinutes: 15,
      minutesToday: 2,
    });
  });

  async function summary(userId: number, now: Date = NOW) {
    return (await home.getHome(userId, now)).data;
  }

  /** `HH:MM` on 2026-10-`day` in Asia/Ho_Chi_Minh. */
  function localTime(day: string, time: string) {
    return new Date(`2026-10-${day}T${time}:00+07:00`);
  }

  /**
   * [E4]/[E5] data: 155 s at 00:30 local on the 7th and 300 s at 11:00
   * local count (455 s, floor(455 / 60) = 7 in Asia/Ho_Chi_Minh; in UTC
   * the day starts at 07:00 local, so only 300 s count = 5); 600 s at 23:30
   * local on the 6th, a null duration, an attempt after `now` and another
   * learner's 900 s do not.
   */
  async function seedMinutesDay(userId: number, otherUserId: number) {
    await addAttempt(userId, new Date('2026-10-06T17:30:00Z'), 155);
    await addAttempt(userId, new Date('2026-10-07T04:00:00Z'), 300);
    await addAttempt(userId, new Date('2026-10-06T16:30:00Z'), 600);
    await addAttempt(userId, new Date('2026-10-07T03:00:00Z'), null);
    await addAttempt(userId, new Date('2026-10-07T06:00:00Z'), 300);
    await addAttempt(otherUserId, new Date('2026-10-07T03:00:00Z'), 900);
  }

  async function createUser(label: string, name: string | null) {
    const user = await prisma.user.create({
      data: {
        email: `home-${label}-${suffix}@example.com`,
        password: 'not-a-real-hash',
        name,
      },
      select: { id: true },
    });
    return user.id;
  }

  async function addProfile(
    userId: number,
    profile: { displayName?: string; timezone?: string },
  ) {
    await prisma.userProfile.create({ data: { userId, ...profile } });
  }

  async function addGoal(userId: number, dailyMinutes: number) {
    await prisma.userGoal.create({
      data: {
        userId,
        targetLevelId: levelId,
        targetBand: 7,
        dailyMinutes,
        startDate: new Date('2026-10-01T00:00:00Z'),
      },
    });
  }

  async function addAttempt(
    userId: number,
    submittedAt: Date,
    durationSeconds: number | null,
  ) {
    attemptNumber += 1;
    const attempt = await prisma.lessonExerciseAttempt.create({
      data: {
        userId,
        exerciseId,
        attemptNumber,
        answer: { optionId: 'hello' },
        contentSnapshot: {},
        isCorrect: true,
        score: 100,
        durationSeconds,
        submittedAt,
      },
      select: { id: true },
    });
    return attempt.id;
  }

  /** Inserts a LearningEvent shaped as the coherence trigger requires. */
  async function addEvent(
    userId: number,
    type: LearningEventType,
    occurredAt: Date,
    attemptId?: number,
  ) {
    eventNumber += 1;
    const location =
      type === 'lesson_started' || type === 'lesson_completed'
        ? { lessonId }
        : type === 'topic_completed'
          ? { lessonId, topicId }
          : type === 'exercise_submitted'
            ? { lessonId, topicId, exerciseId, attemptId }
            : {};
    await prisma.learningEvent.create({
      data: {
        userId,
        type,
        ...location,
        idempotencyKey: `home-event-${eventNumber}`,
        occurredAt,
      },
    });
  }

  async function register(label: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: `home-${label}-${suffix}@example.com`,
        password,
        name: label,
      })
      .expect(201);
    return {
      token: response.body.data.accessToken as string,
      userId: response.body.data.user.id as number,
    };
  }
});
