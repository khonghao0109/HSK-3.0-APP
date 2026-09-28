/// <reference types="jest" />

process.env.MEDIA_UPLOAD_TIMEOUT_MS = '1000';

import { randomUUID } from 'node:crypto';
import * as http from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { configureApiEdgeSecurity } from '../src/config/runtime-security';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

describe('Media Ingestion Upload Timeout E2E', () => {
  jest.setTimeout(30_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let adminId: number;
  let sourceId: number;

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

    const email = `upload-timeout-admin-${suffix}@example.com`;
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password })
      .expect(201);
    adminId = reg.body.data.user.id as number;
    await prisma.user.update({
      where: { id: adminId },
      data: { role: 'admin' },
    });
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    adminToken = loginRes.body.data.accessToken as string;

    sourceId = (
      await prisma.dataSource.create({
        data: {
          code: `MEDIA_TIMEOUT_${suffix}`,
          name: `Synthetic media upload timeout source ${suffix}`,
          version: '2026.08',
          license: 'Synthetic test fixture; not for production publication',
          createdById: adminId,
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('returns 408 MEDIA_UPLOAD_TIMEOUT when upload is too slow on an available slot', async () => {
    await prisma.mediaUploadRateLimit.deleteMany();
    const boundary = '----TimeoutBoundary' + randomUUID();
    const preamble = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="slow-timeout.png"\r\nContent-Type: image/png\r\n\r\n`;
    const postamble = `\r\n--${boundary}--\r\n`;
    const preambleBuf = Buffer.from(preamble);
    const totalChunks = 200;
    const chunkSize = 1024;
    const bodyLength =
      preambleBuf.length +
      totalChunks * chunkSize +
      Buffer.from(postamble).length;

    let dripInterval: NodeJS.Timeout | null = null;
    let safetyTimeout: NodeJS.Timeout | null = null;
    let reqRef: http.ClientRequest | undefined;

    try {
      const result = await new Promise<{
        status: number | null;
        body: { error?: { code?: string; message?: string } } | null;
      }>((resolve, reject) => {
        const port = (app.getHttpServer().address() as { port: number }).port;
        let responseReceived = false;

        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: `/api/v1/admin/cms/media/ingestions?dataSourceId=${sourceId}`,
            method: 'POST',
            headers: {
              Authorization: `Bearer ${adminToken}`,
              'Idempotency-Key': `timeout-upload-${randomUUID()}`,
              'Content-Type': `multipart/form-data; boundary=${boundary}`,
              'Content-Length': bodyLength.toString(),
            },
            agent: false,
          },
          (res: http.IncomingMessage) => {
            responseReceived = true;
            if (dripInterval) clearInterval(dripInterval);
            let data = '';
            res.on('data', (chunk: Buffer) => {
              data += chunk.toString();
            });
            res.on('end', () => {
              try {
                resolve({
                  status: res.statusCode ?? null,
                  body: JSON.parse(data) as {
                    error?: { code?: string; message?: string };
                  },
                });
              } catch {
                resolve({
                  status: res.statusCode ?? null,
                  body: null,
                });
              }
            });
          },
        );
        reqRef = req;

        req.on('error', (err: Error) => {
          if (dripInterval) clearInterval(dripInterval);
          if (!responseReceived) {
            reject(err);
          }
        });

        // Send preamble then drip-feed very slowly to trigger timeout
        req.write(preambleBuf);
        const tinyChunk = Buffer.alloc(64, 0);
        dripInterval = setInterval(() => {
          if (responseReceived) {
            if (dripInterval) clearInterval(dripInterval);
            return;
          }
          try {
            req.write(tinyChunk, () => {});
          } catch {
            if (dripInterval) clearInterval(dripInterval);
          }
        }, 200);

        safetyTimeout = setTimeout(() => {
          if (dripInterval) clearInterval(dripInterval);
          reject(new Error('Test timed out waiting for server 408 response'));
        }, 15_000);
      });

      expect(result.status).toBe(408);
      expect(result.body?.error?.code).toBe('MEDIA_UPLOAD_TIMEOUT');
    } finally {
      if (dripInterval) clearInterval(dripInterval);
      if (safetyTimeout) clearTimeout(safetyTimeout);
      if (reqRef && !reqRef.destroyed) {
        try {
          reqRef.destroy();
        } catch {
          // ignore
        }
      }
    }
  });
});
