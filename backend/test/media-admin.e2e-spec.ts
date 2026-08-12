/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { MediaAdminService } from '../src/modules/cms/media-admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

describe('Media Asset Operations API V1 E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let userToken: string;
  let adminId: number;
  let sourceId: number;
  let readyAudioId: number;
  let pendingImageId: number;

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
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
    prisma = app.get(PrismaService);

    const admin = await register('admin');
    adminId = admin.userId;
    await prisma.user.update({
      where: { id: adminId },
      data: { role: 'admin' },
    });
    adminToken = await login(`media-admin-${suffix}@example.com`);
    userToken = (await register('user')).token;
    sourceId = (
      await prisma.dataSource.create({
        data: {
          code: `MEDIA_${suffix}`,
          name: 'Licensed media E2E',
          version: '2026.08',
          license: 'Synthetic test fixture',
          createdById: adminId,
        },
      })
    ).id;
    readyAudioId = (
      await prisma.media.create({
        data: {
          url: `https://private.example.test/${suffix}/audio.mp3`,
          type: 'audio',
          mimeType: 'audio/mpeg',
          size: 2048,
          duration: 8,
          originalFilename: '../lesson-audio.mp3',
          storageProvider: 'private-test-provider',
          storageKey: `private/${suffix}/audio.mp3`,
          checksum: `checksum-${suffix}`,
          metadata: { signedUrl: `secret-${suffix}` },
          processingStatus: 'ready',
          dataSourceId: sourceId,
          uploadedById: adminId,
          updatedById: adminId,
        },
      })
    ).id;
    pendingImageId = (
      await prisma.media.create({
        data: {
          url: `https://private.example.test/${suffix}/image.png`,
          type: 'image',
          mimeType: 'image/png',
          size: 4096,
          originalFilename: 'cover.png',
          processingStatus: 'pending',
          dataSourceId: sourceId,
          uploadedById: adminId,
          updatedById: adminId,
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('1. requires authentication and current admin role', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/cms/media')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/cms/media')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('2. lists and filters safe operational metadata', async () => {
    const response = await adminGet(
      `/admin/cms/media?type=audio&processingStatus=ready&lifecycle=active&dataSourceId=${sourceId}`,
    ).expect(200);
    expect(response.body.meta.total).toBe(1);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data[0]).toMatchObject({
      id: readyAudioId,
      filename: 'lesson-audio.mp3',
      type: 'audio',
      processingStatus: 'ready',
      lifecycle: 'active',
    });
    expectSafeResponse(response.body);

    const invalid = await adminGet('/admin/cms/media?type=executable').expect(
      400,
    );
    expect(invalid.body).toMatchObject({ code: 'REQUEST_VALIDATION_FAILED' });
  });

  it('3. returns detail with bounded references but no storage secrets', async () => {
    const response = await adminGet(`/admin/cms/media/${readyAudioId}`).expect(
      200,
    );
    expect(response.body.data).toMatchObject({
      id: readyAudioId,
      usage: {
        counts: { lessonExercises: 0, otherContent: 0 },
        lessonExercises: [],
      },
    });
    expectSafeResponse(response.body);
    await adminGet('/admin/cms/media/2147483647').expect(404);
  });

  it('4. quarantines exactly once and writes a safe audit record', async () => {
    const first = await adminPost(
      `/admin/cms/media/${readyAudioId}/quarantine`,
    ).expect(201);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.body.data).toMatchObject({
      idempotent: false,
      media: { id: readyAudioId, processingStatus: 'quarantined' },
    });
    const retry = await adminPost(
      `/admin/cms/media/${readyAudioId}/quarantine`,
    ).expect(201);
    expect(retry.body.data.idempotent).toBe(true);
    const audits = await prisma.auditLog.findMany({
      where: {
        action: 'media.quarantined',
        targetType: 'media',
        targetId: String(readyAudioId),
      },
      select: { action: true, beforeSummary: true, afterSummary: true },
    });
    expect(audits).toHaveLength(1);
    expectSafeResponse(audits);
  });

  it('5. archives exactly once and rejects quarantine after archive', async () => {
    const first = await adminPost(
      `/admin/cms/media/${pendingImageId}/archive`,
    ).expect(201);
    expect(first.body.data).toMatchObject({
      idempotent: false,
      media: { id: pendingImageId, lifecycle: 'archived' },
    });
    const retry = await adminPost(
      `/admin/cms/media/${pendingImageId}/archive`,
    ).expect(201);
    expect(retry.body.data.idempotent).toBe(true);
    await adminPost(`/admin/cms/media/${pendingImageId}/quarantine`).expect(
      409,
    );
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'media.archived',
          targetId: String(pendingImageId),
        },
      }),
    ).resolves.toBe(1);
  });

  it('6. rechecks database role inside lifecycle transaction', async () => {
    const downgraded = await register('downgraded');
    await prisma.user.update({
      where: { id: downgraded.userId },
      data: { role: 'admin' },
    });
    const service = app.get(MediaAdminService);
    const staleActor = { id: downgraded.userId, role: 'admin' };
    await prisma.user.update({
      where: { id: downgraded.userId },
      data: { role: 'user' },
    });
    await expect(
      service.archiveMedia(staleActor, readyAudioId, {
        correlationId: `downgrade-${suffix}`,
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('7. serializes concurrent quarantine retries into one audit fact', async () => {
    const mediaId = (
      await prisma.media.create({
        data: {
          url: `https://private.example.test/${suffix}/race.mp3`,
          type: 'audio',
          mimeType: 'audio/mpeg',
          size: 1024,
          originalFilename: 'race.mp3',
          processingStatus: 'ready',
          dataSourceId: sourceId,
          uploadedById: adminId,
          updatedById: adminId,
        },
      })
    ).id;

    const [first, second] = await Promise.all([
      adminPost(`/admin/cms/media/${mediaId}/quarantine`),
      adminPost(`/admin/cms/media/${mediaId}/quarantine`),
    ]);

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(
      [first.body.data.idempotent, second.body.data.idempotent].sort(),
    ).toEqual([false, true]);
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'media.quarantined',
          targetType: 'media',
          targetId: String(mediaId),
        },
      }),
    ).resolves.toBe(1);
  });

  function adminGet(path: string) {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${adminToken}`);
  }

  function adminPost(path: string) {
    return request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-request-id', crypto.randomUUID());
  }

  async function register(kind: string) {
    const email = `media-${kind}-${suffix}@example.com`;
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password })
      .expect(201);
    return {
      userId: response.body.user.id as number,
      token: response.body.accessToken as string,
    };
  }

  async function login(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    return response.body.accessToken as string;
  }

  function expectSafeResponse(value: unknown) {
    const serialized = JSON.stringify(value);
    for (const secret of [
      'private.example.test',
      'private-test-provider',
      `private/${suffix}`,
      `checksum-${suffix}`,
      `secret-${suffix}`,
    ]) {
      expect(serialized).not.toContain(secret);
    }
  }
});
