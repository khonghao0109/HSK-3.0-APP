/// <reference types="jest" />

import { createHash, randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { TestMediaMalwareScanner } from '../src/infrastructure/malware/test-media-malware-scanner';
import { InMemoryObjectStorageAdapter } from '../src/infrastructure/storage/in-memory-object-storage.adapter';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

describe('Secure Media Ingestion V1 E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: InMemoryObjectStorageAdapter;
  let scanner: TestMediaMalwareScanner;
  let adminToken: string;
  let userToken: string;
  let adminId: number;
  let sourceId: number;
  let unlicensedSourceId: number;
  let png!: Buffer;

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
    storage = app.get(InMemoryObjectStorageAdapter);
    scanner = app.get(TestMediaMalwareScanner);

    const admin = await register('admin');
    adminId = admin.userId;
    await prisma.user.update({
      where: { id: adminId },
      data: { role: 'admin' },
    });
    adminToken = await login(`ingestion-admin-${suffix}@example.com`);
    userToken = (await register('user')).token;
    sourceId = (
      await prisma.dataSource.create({
        data: {
          code: `MEDIA_INGEST_${suffix}`,
          name: `Synthetic licensed media ingestion source ${suffix}`,
          version: '2026.08',
          license: 'Synthetic test fixture; not for production publication',
          createdById: adminId,
        },
      })
    ).id;
    unlicensedSourceId = (
      await prisma.dataSource.create({
        data: {
          code: `MEDIA_UNLICENSED_${suffix}`,
          name: `Synthetic media source pending license review ${suffix}`,
          version: '2026.08',
          createdById: adminId,
        },
      })
    ).id;
    png = await sharp({
      create: {
        width: 4,
        height: 3,
        channels: 4,
        background: { r: 12, g: 34, b: 56, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
  });

  beforeEach(async () => {
    await prisma.mediaUploadRateLimit.deleteMany();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('1. rejects unauthenticated and non-admin uploads before persistence', async () => {
    const storageBaseline = storage.count();
    const mediaBaseline = await ownedMediaCount();
    const ingestionBaseline = await prisma.mediaIngestion.count({
      where: { actorId: adminId },
    });
    await upload(undefined, png, 'lesson.png', 'image/png').expect(401);
    await upload(userToken, png, 'lesson.png', 'image/png').expect(403);
    await expect(
      prisma.mediaIngestion.count({ where: { actorId: adminId } }),
    ).resolves.toBe(ingestionBaseline);
    expect(storage.count()).toBe(storageBaseline);
    await expect(ownedMediaCount()).resolves.toBe(mediaBaseline);
  });

  it('1b. disables new ingestion without disabling the application', async () => {
    const config = app.get(ConfigService);
    const storageBaseline = storage.count();
    config.set('media.ingestionEnabled', false);
    try {
      const response = await upload(
        adminToken,
        png,
        'disabled.png',
        'image/png',
      ).expect(503);
      expect(response.body).toEqual({
        code: 'MEDIA_INGESTION_DISABLED',
        message: 'Media ingestion is temporarily disabled.',
      });
      expect(storage.count()).toBe(storageBaseline);
    } finally {
      config.set('media.ingestionEnabled', true);
    }
  });

  it.each([
    [
      'spoofed extension',
      () => png,
      'lesson.jpg',
      'image/png',
      'FILENAME_EXTENSION_MISMATCH',
    ],
    [
      'spoofed content type',
      () => png,
      'lesson.png',
      'audio/mpeg',
      'MIME_SIGNATURE_MISMATCH',
    ],
    [
      'signature mismatch',
      () => Buffer.from('not-a-png'),
      'lesson.png',
      'image/png',
      'MIME_SIGNATURE_MISMATCH',
    ],
    [
      'empty file',
      () => Buffer.alloc(0),
      'lesson.png',
      'image/png',
      'FILE_SIZE_INVALID',
    ],
    [
      'truncated image',
      () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      'lesson.png',
      'image/png',
      'FILE_MALFORMED',
    ],
    [
      'double extension',
      () => png,
      'lesson.pdf.png',
      'image/png',
      'FILENAME_EXTENSION_MISMATCH',
    ],
  ])(
    '2. rejects %s without object or ready Media',
    async (_, bodyFactory, name, mime, code) => {
      const body = bodyFactory();
      const storageBaseline = storage.count();
      const mediaBaseline = await ownedMediaCount();
      const response = await upload(adminToken, body, name, mime).expect(422);
      expect(response.body).toMatchObject({ code });
      if (body.length > 0) {
        expect(JSON.stringify(response.body)).not.toContain(
          body.toString('base64'),
        );
      }
      expect(storage.count()).toBe(storageBaseline);
      await expect(ownedMediaCount()).resolves.toBe(mediaBaseline);
    },
  );

  it.each([
    '../lesson.png',
    '..\\lesson.png',
    'C:\\lesson.png',
    '..／lesson.png',
    '..%252flesson.png',
  ])(
    '3. rejects unsafe filename %j with a generic redacted error',
    async (name) => {
      const storageBaseline = storage.count();
      const mediaBaseline = await ownedMediaCount();
      const response = await rawUpload(name, png, 'image/png').expect(400);
      expect(response.body.message).toBe('Upload filename is not allowed.');
      expect(JSON.stringify(response.body)).not.toContain(name);
      expect(storage.count()).toBe(storageBaseline);
      await expect(ownedMediaCount()).resolves.toBe(mediaBaseline);
    },
  );

  it('4. rejects an oversized request at the parser boundary', async () => {
    const storageBaseline = storage.count();
    const mediaBaseline = await ownedMediaCount();
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 0x41);
    await upload(adminToken, oversized, 'large.png', 'image/png').expect(413);
    expect(storage.count()).toBe(storageBaseline);
    await expect(ownedMediaCount()).resolves.toBe(mediaBaseline);
  });

  it('5. redacts an attacker-controlled multipart field and rejects an unlicensed source', async () => {
    const storageBaseline = storage.count();
    const mediaBaseline = await ownedMediaCount();
    const malformed = await request(app.getHttpServer())
      .post(`/api/v1/admin/cms/media/ingestions?dataSourceId=${sourceId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `media-ingest-${randomUUID()}`)
      .attach('secret@example.com', png, {
        filename: 'secret.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect(malformed.body).toMatchObject({ code: 'MULTIPART_INVALID' });
    expect(JSON.stringify(malformed.body)).not.toContain('secret@example.com');

    const unlicensed = await upload(
      adminToken,
      png,
      'license.png',
      'image/png',
      `media-ingest-${randomUUID()}`,
      unlicensedSourceId,
    ).expect(422);
    expect(unlicensed.body).toMatchObject({
      code: 'MEDIA_SOURCE_NOT_APPROVED',
    });
    expect(storage.count()).toBe(storageBaseline);
    await expect(ownedMediaCount()).resolves.toBe(mediaBaseline);
  });

  it('6. creates one ready private object and one safe audit on exact retry', async () => {
    const storageBaseline = storage.count();
    const mediaBaseline = await ownedMediaCount();
    const key = `media-ingest-success-${randomUUID()}`;
    const first = await upload(
      adminToken,
      png,
      'lesson.png',
      'image/png',
      key,
    ).expect(201);
    const retry = await upload(
      adminToken,
      png,
      'lesson.png',
      'image/png',
      key,
    ).expect(201);
    expect(first.body.data).toMatchObject({
      idempotent: false,
      media: {
        type: 'image',
        mimeType: 'image/png',
        processingStatus: 'ready',
      },
    });
    expect(retry.body.data).toMatchObject({
      idempotent: true,
      media: { id: first.body.data.media.id },
    });
    expect(storage.count()).toBe(storageBaseline + 1);
    await expect(ownedMediaCount()).resolves.toBe(mediaBaseline + 1);
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'media.ingested',
          targetId: String(first.body.data.media.id),
        },
      }),
    ).resolves.toBe(1);
    const serialized = JSON.stringify(
      await prisma.auditLog.findFirst({
        where: {
          action: 'media.ingested',
          targetId: String(first.body.data.media.id),
        },
        select: { beforeSummary: true, afterSummary: true },
      }),
    );
    expect(serialized).not.toContain(key);
    expect(serialized).not.toContain('storageKey');
    expect(serialized).not.toContain('checksum');
  });

  it('7. permits duplicate display filenames under opaque keys and fail-closes concurrent retry', async () => {
    const baseline = storage.count();
    const first = await upload(
      adminToken,
      png,
      'duplicate.png',
      'image/png',
    ).expect(201);
    const second = await upload(
      adminToken,
      png,
      'duplicate.png',
      'image/png',
    ).expect(201);
    expect(first.body.data.media.id).not.toBe(second.body.data.media.id);
    expect(storage.count()).toBe(baseline + 2);

    const concurrentKey = `media-ingest-concurrent-${randomUUID()}`;
    const concurrentStorageBaseline = storage.count();
    const concurrentMediaBaseline = await ownedMediaCount();
    const responses = await Promise.all([
      upload(adminToken, png, 'concurrent.png', 'image/png', concurrentKey),
      upload(adminToken, png, 'concurrent.png', 'image/png', concurrentKey),
    ]);
    expect(responses.some(({ status }) => status === 201)).toBe(true);
    expect(
      responses.every(({ status }) => status === 201 || status === 409),
    ).toBe(true);
    const keyHash = createHash('sha256').update(concurrentKey).digest('hex');
    await expect(
      prisma.mediaIngestion.count({
        where: { actorId: adminId, idempotencyKeyHash: keyHash },
      }),
    ).resolves.toBe(1);
    const concurrentIngestion = await prisma.mediaIngestion.findUniqueOrThrow({
      where: {
        actorId_idempotencyKeyHash: {
          actorId: adminId,
          idempotencyKeyHash: keyHash,
        },
      },
      select: { mediaId: true, status: true },
    });
    expect(concurrentIngestion).toMatchObject({ status: 'completed' });
    expect(concurrentIngestion.mediaId).not.toBeNull();
    expect(storage.count()).toBe(concurrentStorageBaseline + 1);
    await expect(ownedMediaCount()).resolves.toBe(concurrentMediaBaseline + 1);
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'media.ingested',
          targetId: String(concurrentIngestion.mediaId),
        },
      }),
    ).resolves.toBe(1);
  });

  it('8. rejects reusing an idempotency key for a different request', async () => {
    const key = `media-ingest-conflict-${randomUUID()}`;
    await upload(adminToken, png, 'first.png', 'image/png', key).expect(201);
    await upload(adminToken, png, 'second.png', 'image/png', key).expect(409);
  });

  it('9. leaves no new object or Media on rejection, storage, processing and database failure', async () => {
    const storageBaseline = storage.count();
    const mediaBaseline = await ownedMediaCount();

    scanner.rejectNextScan();
    const rejected = await upload(
      adminToken,
      png,
      'malware.png',
      'image/png',
    ).expect(422);
    expect(rejected.body).toMatchObject({ code: 'MALWARE_DETECTED' });

    const uncertainKey = `media-ingest-uncertain-${randomUUID()}`;
    storage.failNextPutAfterWrite();
    const uncertain = await upload(
      adminToken,
      png,
      'uncertain.png',
      'image/png',
      uncertainKey,
    ).expect(503);
    expect(uncertain.body).toMatchObject({ code: 'MEDIA_CLEANUP_REQUIRED' });
    expect(storage.count()).toBe(storageBaseline + 1);
    const uncertainIngestion = await prisma.mediaIngestion.findUniqueOrThrow({
      where: {
        actorId_idempotencyKeyHash: {
          actorId: adminId,
          idempotencyKeyHash: createHash('sha256')
            .update(uncertainKey)
            .digest('hex'),
        },
      },
      select: {
        cleanupAttempts: true,
        failureCode: true,
        id: true,
        mediaId: true,
        status: true,
        storageKey: true,
      },
    });
    expect(uncertainIngestion).toMatchObject({
      cleanupAttempts: 0,
      failureCode: 'OBJECT_WRITE_OUTCOME_UNKNOWN',
      mediaId: null,
      status: 'cleanup_required',
    });
    expect(uncertainIngestion.storageKey).not.toBeNull();
    const firstUnknownCleanup = await request(app.getHttpServer())
      .post(
        `/api/v1/admin/cms/media/ingestions/${uncertainIngestion.id}/cleanup`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-request-id', randomUUID())
      .expect(201);
    expect(firstUnknownCleanup.body).toMatchObject({
      data: { cleanupCompleted: false, settling: true },
    });
    await expect(
      prisma.mediaIngestion.findUniqueOrThrow({
        where: { id: uncertainIngestion.id },
        select: {
          cleanupAttempts: true,
          failureCode: true,
          mediaId: true,
          status: true,
        },
      }),
    ).resolves.toEqual({
      cleanupAttempts: 1,
      failureCode: 'OBJECT_CLEANUP_SETTLING',
      mediaId: null,
      status: 'cleanup_required',
    });
    expect(storage.count()).toBe(storageBaseline);
    await ageCleanupObservation(uncertainIngestion.id);
    await request(app.getHttpServer())
      .post(
        `/api/v1/admin/cms/media/ingestions/${uncertainIngestion.id}/cleanup`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-request-id', randomUUID())
      .expect(201);
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'media.ingestion_cleanup_completed',
          targetId: String(uncertainIngestion.id),
        },
      }),
    ).resolves.toBe(1);

    storage.failNextPut();
    await upload(adminToken, png, 'storage.png', 'image/png').expect(503);

    await prisma.mediaUploadRateLimit.deleteMany({
      where: { actorId: adminId },
    });

    scanner.failNextScan();
    await upload(adminToken, png, 'scanner.png', 'image/png').expect(503);

    await installMediaInsertFailureTrigger();
    try {
      await upload(adminToken, png, 'database.png', 'image/png').expect(503);
    } finally {
      await removeMediaInsertFailureTrigger();
    }

    await installMediaInsertFailureTrigger();
    storage.failNextDelete();
    const cleanupKey = `media-ingest-cleanup-${randomUUID()}`;
    try {
      await upload(
        adminToken,
        png,
        'cleanup.png',
        'image/png',
        cleanupKey,
      ).expect(503);
    } finally {
      await removeMediaInsertFailureTrigger();
    }
    const cleanupRequired = await prisma.mediaIngestion.findUniqueOrThrow({
      where: {
        actorId_idempotencyKeyHash: {
          actorId: adminId,
          idempotencyKeyHash: createHash('sha256')
            .update(cleanupKey)
            .digest('hex'),
        },
      },
      select: {
        id: true,
        cleanupAttempts: true,
        failureCode: true,
        storageKey: true,
      },
    });
    expect(cleanupRequired).toMatchObject({
      cleanupAttempts: 1,
      failureCode: 'OBJECT_CLEANUP_REQUIRED',
    });
    expect(storage.count()).toBe(storageBaseline + 1);

    storage.failNextDelete();
    const failedCleanup = await request(app.getHttpServer())
      .post(`/api/v1/admin/cms/media/ingestions/${cleanupRequired.id}/cleanup`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-request-id', randomUUID())
      .expect(503);
    expect(failedCleanup.body).toMatchObject({
      code: 'MEDIA_CLEANUP_REQUIRED',
    });
    await expect(
      prisma.mediaIngestion.findUniqueOrThrow({
        where: { id: cleanupRequired.id },
        select: {
          cleanupAttempts: true,
          failureCode: true,
          status: true,
          storageKey: true,
        },
      }),
    ).resolves.toEqual({
      cleanupAttempts: 2,
      failureCode: 'OBJECT_CLEANUP_REQUIRED',
      status: 'cleanup_required',
      storageKey: cleanupRequired.storageKey,
    });
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'media.ingestion_cleanup_failed',
          targetId: String(cleanupRequired.id),
        },
      }),
    ).resolves.toBe(1);

    const deleteBarrier = storage.blockNextDelete();
    const cleanupPromise = request(app.getHttpServer())
      .post(`/api/v1/admin/cms/media/ingestions/${cleanupRequired.id}/cleanup`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-request-id', randomUUID())
      .expect(201)
      .then((response) => response);
    await deleteBarrier.started;
    await upload(
      adminToken,
      png,
      'cleanup.png',
      'image/png',
      cleanupKey,
    ).expect(409);
    deleteBarrier.release();
    const settlingCleanup = await cleanupPromise;
    expect(settlingCleanup.body).toMatchObject({
      data: { cleanupCompleted: false, settling: true },
    });
    expect(storage.count()).toBe(storageBaseline);
    await expect(ownedMediaCount()).resolves.toBe(mediaBaseline);
    await ageCleanupObservation(cleanupRequired.id);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/cms/media/ingestions/${cleanupRequired.id}/cleanup`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-request-id', randomUUID())
      .expect(201);
    await expect(
      prisma.mediaIngestion.findUniqueOrThrow({
        where: { id: cleanupRequired.id },
        select: {
          cleanupAttempts: true,
          failureCode: true,
          mediaId: true,
          status: true,
        },
      }),
    ).resolves.toEqual({
      cleanupAttempts: 4,
      failureCode: 'OBJECT_CLEANED',
      mediaId: null,
      status: 'failed',
    });
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'media.ingestion_cleanup_completed',
          targetId: String(cleanupRequired.id),
        },
      }),
    ).resolves.toBe(1);
  });

  async function ageCleanupObservation(ingestionId: number): Promise<void> {
    await prisma.$executeRaw`
      UPDATE "MediaIngestion"
      SET "cleanupAbsentObservedAt" =
        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '2 minutes'
      WHERE id = ${ingestionId}
    `;
  }

  it('10. serves only an authorized short-lived signed access grant', async () => {
    const unsupported = await prisma.media.create({
      data: {
        url: `urn:hsk:test:unsupported-${randomUUID()}`,
        type: 'pdf',
        mimeType: 'application/pdf',
        size: 8,
        storageProvider: storage.provider,
        storageKey: `media/test/${randomUUID()}.pdf`,
        checksum: createHash('sha256').update('pdf-test').digest('hex'),
        processingStatus: 'ready',
        dataSourceId: sourceId,
        uploadedById: adminId,
        updatedById: adminId,
      },
      select: { id: true },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/media/${unsupported.id}/access`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);

    const key = `media-ingest-access-${randomUUID()}`;
    const uploaded = await upload(
      adminToken,
      png,
      'access.png',
      'image/png',
      key,
    ).expect(201);
    const mediaId = uploaded.body.data.media.id as number;

    await request(app.getHttpServer())
      .get(`/api/v1/media/${mediaId}/access`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/api/v1/media/${mediaId}/access`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
    const grant = await request(app.getHttpServer())
      .get(`/api/v1/media/${mediaId}/access`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(grant.body.data.url).toMatch(
      new RegExp(
        `^/api/v1/media/${mediaId}/content\\?expires=\\d+&signature=[a-f0-9]{64}$`,
        'u',
      ),
    );
    const content = await request(app.getHttpServer())
      .get(grant.body.data.url)
      .expect(200);
    expect(content.headers['content-type']).toBe('image/png');
    expect(content.headers['cache-control']).toBe('private, no-store');
    expect(content.headers['x-content-type-options']).toBe('nosniff');
    await request(app.getHttpServer())
      .get(
        `/api/v1/media/${mediaId}/content?expires=${Math.floor(Date.now() / 1000) + 300}&signature=${'b'.repeat(64)}`,
      )
      .expect(403);
    await request(app.getHttpServer())
      .get(
        `/api/v1/media/${mediaId}/content?expires=1&signature=${'a'.repeat(64)}`,
      )
      .expect(403);
  });

  it('11. limits upload attempts per admin in the shared database', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await upload(
        adminToken,
        Buffer.from('invalid'),
        `invalid-${attempt}.png`,
        'image/png',
      ).expect(422);
    }
    await upload(
      adminToken,
      Buffer.from('invalid'),
      'rate-limited.png',
      'image/png',
    ).expect(429);
  });

  it('12. exposes redacted bounded media metrics only with the scrape credential', async () => {
    const token = app
      .get(ConfigService)
      .getOrThrow<string>('media.metricsBearerToken');
    await request(app.getHttpServer())
      .get('/api/v1/internal/metrics/media')
      .expect(403);
    const response = await request(app.getHttpServer())
      .get('/api/v1/internal/metrics/media')
      .set('Authorization', `Bearer ${token}`)
      .expect('Content-Type', /text\/plain/u)
      .expect(200);
    expect(response.text).toContain('hsk_media_ingestion_total');
    expect(response.text).toContain('hsk_media_cleanup_required');
    expect(response.text).not.toMatch(
      /mediaId|storageKey|filename|signature|@/u,
    );
  });

  function upload(
    token: string | undefined,
    body: Buffer,
    filename: string,
    mimeType: string,
    key = `media-ingest-${randomUUID()}`,
    selectedSourceId = sourceId,
  ) {
    let operation = request(app.getHttpServer())
      .post(
        `/api/v1/admin/cms/media/ingestions?dataSourceId=${selectedSourceId}`,
      )
      .set('Idempotency-Key', key)
      .set('x-request-id', randomUUID())
      .attach('file', body, { filename, contentType: mimeType });
    if (token) operation = operation.set('Authorization', `Bearer ${token}`);
    return operation;
  }

  function rawUpload(filename: string, body: Buffer, mimeType: string) {
    const boundary = `hsk-media-${randomUUID()}`;
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ),
      body,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return request(app.getHttpServer())
      .post(`/api/v1/admin/cms/media/ingestions?dataSourceId=${sourceId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `media-ingest-${randomUUID()}`)
      .set('x-request-id', randomUUID())
      .set('Content-Type', `multipart/form-data; boundary=${boundary}`)
      .send(payload);
  }

  function ownedMediaCount(): Promise<number> {
    return prisma.media.count({ where: { uploadedById: adminId } });
  }

  async function register(kind: string) {
    const email = `ingestion-${kind}-${suffix}@example.com`;
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

  async function installMediaInsertFailureTrigger(): Promise<void> {
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION hsk_test_reject_media_insert()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Synthetic Media insert failure.';
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "Media_test_reject_insert"
      BEFORE INSERT ON "Media"
      FOR EACH ROW EXECUTE FUNCTION hsk_test_reject_media_insert()
    `);
  }

  async function removeMediaInsertFailureTrigger(): Promise<void> {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS "Media_test_reject_insert" ON "Media"',
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS hsk_test_reject_media_insert()',
    );
  }
});
