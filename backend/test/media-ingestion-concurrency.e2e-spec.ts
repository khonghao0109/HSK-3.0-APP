/// <reference types="jest" />

process.env.MEDIA_INGESTION_MAX_CONCURRENCY = '1';

import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { configureApiEdgeSecurity } from '../src/config/runtime-security';
import { TestMediaMalwareScanner } from '../src/infrastructure/malware/test-media-malware-scanner';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

describe('Media Ingestion Concurrency Limiting E2E', () => {
  jest.setTimeout(30_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let scanner: TestMediaMalwareScanner;
  let adminToken: string;
  let adminId: number;
  let sourceId: number;
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
    configureApiEdgeSecurity(app, moduleFixture.get(ConfigService));
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    scanner = app.get(TestMediaMalwareScanner);

    const admin = await register('admin');
    adminId = admin.userId;
    await prisma.user.update({
      where: { id: adminId },
      data: { role: 'admin' },
    });
    adminToken = await login(
      `ingestion-concurrency-admin-${suffix}@example.com`,
    );
    sourceId = (
      await prisma.dataSource.create({
        data: {
          code: `MEDIA_CONCURRENCY_${suffix}`,
          name: `Synthetic media ingestion concurrency source ${suffix}`,
          version: '2026.08',
          license: 'Synthetic test fixture; not for production publication',
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

  it('rejects overlapping upload with 503 MEDIA_INGESTION_BUSY and accepts new upload after slot releases', async () => {
    const barrier = scanner.blockNextScan();

    const upload1Promise = new Promise<request.Response>((resolve, reject) => {
      upload(
        adminToken,
        png,
        'first.png',
        'image/png',
        `media-concurrency-${randomUUID()}`,
      ).end((err, res) => {
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
        else resolve(res);
      });
    });

    try {
      await barrier.started;

      const upload2Response = await upload(
        adminToken,
        png,
        'second.png',
        'image/png',
        `media-concurrency-${randomUUID()}`,
      );

      expect(upload2Response.status).toBe(503);
      expect(upload2Response.header['retry-after']).toBe('1');
      expect(upload2Response.body).toMatchObject({
        error: {
          code: 'MEDIA_INGESTION_BUSY',
          message: 'Media ingestion service is busy. Please try again later.',
        },
      });
    } finally {
      barrier.release();
    }

    const upload1Response = await upload1Promise;
    expect(upload1Response.status).toBe(201);
    expect(upload1Response.body.data.media.id).toBeDefined();

    const upload3Response = await upload(
      adminToken,
      png,
      'third.png',
      'image/png',
      `media-concurrency-${randomUUID()}`,
    );
    expect(upload3Response.status).toBe(201);
    expect(upload3Response.body.data.media.id).toBeDefined();
  });

  function upload(
    token: string,
    body: Buffer,
    filename: string,
    mimeType: string,
    key: string,
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/admin/cms/media/ingestions?dataSourceId=${sourceId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .set('x-request-id', randomUUID())
      .attach('file', body, { filename, contentType: mimeType });
  }

  async function register(kind: string) {
    const email = `ingestion-concurrency-${kind}-${suffix}@example.com`;
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password })
      .expect(201);
    return {
      userId: response.body.data.user.id as number,
      token: response.body.data.accessToken as string,
    };
  }

  async function login(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    return response.body.data.accessToken as string;
  }
});
