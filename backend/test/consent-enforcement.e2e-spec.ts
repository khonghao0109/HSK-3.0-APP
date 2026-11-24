/// <reference types="jest" />

import { createHash } from 'node:crypto';

import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { buildLessonReadyWhere } from '../src/common/policies/lesson-readiness.policy';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { hashPasswordWithPepper } from '../src/modules/auth/utils/password-hasher';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

type Envelope<T> = { success: boolean; data: T };

/**
 * M1.7b2 phase B (Q189): a learner past `effectiveAt` without consent gets
 * 403 CONSENT_REQUIRED on every JWT route except the reviewed allowlist.
 */
describe('Consent enforcement E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordHash: string;

  const stamp = Date.now().toString(36);
  // Versions owned by this suite only; distinct from consent.e2e-spec.ts.
  const VERSION_PREFIX = 'e2e-ce-';
  const termsVersion = `${VERSION_PREFIX}${stamp}-t`;
  const privacyVersion = `${VERSION_PREFIX}${stamp}-p`;
  const termsSha = createHash('sha256')
    .update(`ce-terms-${stamp}`)
    .digest('hex');
  const privacySha = createHash('sha256')
    .update(`ce-privacy-${stamp}`)
    .digest('hex');
  const effectiveAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const documents = () => [
    { type: 'terms', version: termsVersion, sha256: termsSha },
    { type: 'privacy', version: privacyVersion, sha256: privacySha },
  ];

  const prefix = `e2e_consent_enf_${stamp}`;
  const password = 'Password123!';
  const http = () => request(app.getHttpServer());

  /** A user with no consent row; with versions in force they are `blocked`. */
  const createUser = async (
    label: string,
    role: 'user' | 'admin' = 'user',
  ): Promise<{ token: string; userId: number }> => {
    const email = `${prefix}_${label}@example.com`;
    const user = await prisma.user.create({
      data: { email, password: passwordHash, role },
      select: { id: true },
    });
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(HttpStatus.CREATED);
    return {
      token: (res.body as Envelope<{ accessToken: string }>).data.accessToken,
      userId: user.id,
    };
  };

  const cleanupVersions = () =>
    prisma.legalDocumentVersion.deleteMany({
      where: { version: { startsWith: VERSION_PREFIX } },
    });

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
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    const pepper = app.get(ConfigService).get<string>('AUTH_PASSWORD_PEPPER');
    passwordHash = await hashPasswordWithPepper(password, pepper ?? '');

    await cleanupVersions();
    await prisma.legalDocumentVersion.createMany({
      data: [
        { type: 'terms', version: termsVersion, sha256: termsSha, effectiveAt },
        {
          type: 'privacy',
          version: privacyVersion,
          sha256: privacySha,
          effectiveAt,
        },
      ],
    });
  });

  afterAll(async () => {
    if (prisma) await cleanupVersions();
    await app?.close();
  });

  // One route per learner controller (12 groups); any route left unlisted
  // here is still covered by the allowlist inventory unit test.
  const LEARNER_ROUTES: Array<
    [method: 'get' | 'post' | 'patch', path: string]
  > = [
    ['get', '/learning/courses'],
    ['get', '/learning/home'],
    ['get', '/progress/lessons'],
    ['get', '/learning/lessons/1/activity'],
    ['get', '/learning/path'],
    ['get', '/review/queue'],
    ['get', '/exam/tests'],
    ['get', '/onboarding/status'],
    ['get', '/learning-plans/current'],
    ['post', '/dictionary/words/1/save'],
    ['get', '/media/1/access'],
    ['patch', '/users/me/profile'],
  ];

  describe('blocked learner', () => {
    it.each(LEARNER_ROUTES)(
      'answers 403 CONSENT_REQUIRED on %s %s',
      async (method, path) => {
        const { token } = await createUser(
          `route_${method}_${path.replace(/\W+/g, '_')}`,
        );
        const res = await http()
          [method](`/api/v1${path}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ name: 'x' })
          .expect(HttpStatus.FORBIDDEN);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('CONSENT_REQUIRED');
      },
    );

    it('never runs the handler: starting a lesson writes no Progress', async () => {
      // A ready lesson of this suite. The shared level is reused as it is
      // (`update: {}` never changes its status); the ready check below fails
      // loudly if another suite left it unpublished.
      const level = await prisma.level.upsert({
        where: { code: 'HSK7_9' },
        update: {},
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
      });
      // Below every lesson of the level, so it is the first and unlocked
      // whatever other suites created; soft-deleted at the end so it never
      // locks their lessons in turn.
      const { _min } = await prisma.lesson.aggregate({
        where: { levelId: level.id },
        _min: { orderIndex: true },
      });
      const lesson = await prisma.lesson.create({
        data: {
          levelId: level.id,
          title: 'Consent gate lesson',
          orderIndex:
            Math.min(_min.orderIndex ?? 0, 0) -
            1 -
            Math.floor(Math.random() * 1000),
          slug: `${prefix.replace(/_/g, '-')}-lesson`,
          status: 'published',
          publishedAt: new Date(),
          topics: {
            create: {
              title: 'Consent gate topic',
              content: [{ type: 'text', value: 'Gate.' }],
              orderIndex: 1,
              status: 'published',
              publishedAt: new Date(),
            },
          },
        },
        select: { id: true },
      });
      try {
        expect(
          await prisma.lesson.count({
            where: buildLessonReadyWhere({ id: lesson.id }),
          }),
        ).toBe(1);
        const { token, userId } = await createUser('start_lesson');
        const start = () =>
          http()
            .post(`/api/v1/learning/lessons/${lesson.id}/start`)
            .set('Authorization', `Bearer ${token}`)
            .set('Idempotency-Key', `consent-gate-${stamp}`)
            .send({});

        const blocked = await start().expect(HttpStatus.FORBIDDEN);
        expect(blocked.body.error.code).toBe('CONSENT_REQUIRED');
        expect(await prisma.progress.count({ where: { userId } })).toBe(0);

        await http()
          .post('/api/v1/users/me/consents/accept')
          .set('Authorization', `Bearer ${token}`)
          .send({ documents: documents() })
          .expect(HttpStatus.OK);
        // Same request now reaches the handler, so the 403 above was the gate.
        await start().expect(HttpStatus.CREATED);
        expect(await prisma.progress.count({ where: { userId } })).toBe(1);
      } finally {
        await prisma.lesson.update({
          where: { id: lesson.id },
          data: { deletedAt: new Date() },
        });
      }
    });

    it('still serves every allowlisted route', async () => {
      const { token } = await createUser('allowlist');
      const auth = { Authorization: `Bearer ${token}` };

      await http().get('/api/v1/legal/documents/current').expect(HttpStatus.OK);
      await http()
        .get('/api/v1/users/me/consents')
        .set(auth)
        .expect(HttpStatus.OK);
      await http()
        .put('/api/v1/users/me/consents/optional/analytics')
        .set(auth)
        .send({ granted: false })
        .expect(HttpStatus.OK);
      await http().get('/api/v1/auth/me').set(auth).expect(HttpStatus.OK);
      await http()
        .post('/api/v1/auth/email-verification/request')
        .set(auth)
        .expect(HttpStatus.NO_CONTENT);
      await http().get('/api/v1/users/me').set(auth).expect(HttpStatus.OK);
      await http()
        .get('/api/v1/users/me/profile')
        .set(auth)
        .expect(HttpStatus.OK);
      await http()
        .post('/api/v1/users/me/data-exports')
        .set(auth)
        .expect(HttpStatus.ACCEPTED);
      await http()
        .get('/api/v1/users/me/data-exports')
        .set(auth)
        .expect(HttpStatus.OK);
      // Not this user's export: the handler ran and answered 404, not 403.
      await http()
        .get('/api/v1/users/me/data-exports/2147483647/download')
        .set(auth)
        .expect(HttpStatus.NOT_FOUND);
      await http()
        .post('/api/v1/auth/logout')
        .set(auth)
        .expect(HttpStatus.NO_CONTENT);
    });

    it('still accepts an account deletion request', async () => {
      const { token } = await createUser('deletion');
      await http()
        .post('/api/v1/users/me/deletion-request')
        .set('Authorization', `Bearer ${token}`)
        .send({ password })
        .expect(HttpStatus.ACCEPTED);
    });

    it('is unblocked once the user accepts the current versions', async () => {
      const { token } = await createUser('accept');
      const path = () =>
        http()
          .get('/api/v1/learning/path')
          .set('Authorization', `Bearer ${token}`);
      await path().expect(HttpStatus.FORBIDDEN);
      await http()
        .post('/api/v1/users/me/consents/accept')
        .set('Authorization', `Bearer ${token}`)
        .send({ documents: documents() })
        .expect(HttpStatus.OK);
      await path().expect(HttpStatus.OK);
    });

    it('is still blocked after accepting only one of the two documents', async () => {
      const { token } = await createUser('accept_one');
      await http()
        .post('/api/v1/users/me/consents/accept')
        .set('Authorization', `Bearer ${token}`)
        .send({ documents: documents().slice(0, 1) })
        .expect(HttpStatus.OK);
      await http()
        .get('/api/v1/learning/path')
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.FORBIDDEN);
    });
  });

  describe('admin', () => {
    it('is never blocked, on admin or learner routes', async () => {
      const { token } = await createUser('admin', 'admin');
      const auth = { Authorization: `Bearer ${token}` };
      await http().get('/api/v1/admin/users').set(auth).expect(HttpStatus.OK);
      await http()
        .get('/api/v1/admin/cms/courses')
        .set(auth)
        .expect(HttpStatus.OK);
      await http().get('/api/v1/learning/path').set(auth).expect(HttpStatus.OK);
    });
  });

  // Last: registers a newer version, which changes the current one for all.
  describe('pending learner', () => {
    it('is not blocked while a new version is within its 14 days', async () => {
      const { token } = await createUser('pending');
      await http()
        .post('/api/v1/users/me/consents/accept')
        .set('Authorization', `Bearer ${token}`)
        .send({ documents: documents() })
        .expect(HttpStatus.OK);
      await prisma.legalDocumentVersion.create({
        data: {
          type: 'terms',
          version: `${VERSION_PREFIX}${stamp}-t2`,
          sha256: createHash('sha256')
            .update(`ce-terms2-${stamp}`)
            .digest('hex'),
          effectiveAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      const consents = await http()
        .get('/api/v1/users/me/consents')
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);
      expect(
        (
          consents.body as Envelope<{ documents: Array<{ status: string }> }>
        ).data.documents.map((d) => d.status),
      ).toEqual(['pending', 'accepted']);
      await http()
        .get('/api/v1/learning/path')
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);
    });
  });
});
