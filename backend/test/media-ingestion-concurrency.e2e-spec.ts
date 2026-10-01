/// <reference types="jest" />

process.env.MEDIA_INGESTION_MAX_CONCURRENCY = '1';

import { createHash, randomUUID } from 'node:crypto';
import * as http from 'node:http';
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
  let adminToken2: string;
  let adminId: number;
  let sourceId: number;
  let png!: Buffer;
  let eightMbPng!: Buffer;

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
    adminToken2 = await createAdmin(99);
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

    eightMbPng = Buffer.alloc(8 * 1024 * 1024);
    png.copy(eightMbPng, 0);
  });

  beforeEach(async () => {
    await prisma.mediaUploadRateLimit.deleteMany();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('rejects 10 concurrent 8 MiB uploads with 503 MEDIA_INGESTION_BUSY while slot is held, without ECONNRESET/EPIPE', async () => {
    const tokens: string[] = [];
    for (let i = 0; i < 10; i++) {
      tokens.push(await createAdmin(i));
    }
    await prisma.mediaUploadRateLimit.deleteMany();

    const barrier = scanner.blockNextScan();
    const upload1Promise = new Promise<request.Response>((resolve, reject) => {
      upload(
        adminToken,
        png,
        'held.png',
        'image/png',
        `media-concurrency-held-${randomUUID()}`,
      ).end((err, res) => {
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
        else resolve(res);
      });
    });

    const busyKeys: string[] = [];
    try {
      await barrier.started;

      const busyUploadPromises = tokens.map((token, index) => {
        const key = `media-busy-8mb-${index}-${randomUUID()}`;
        busyKeys.push(key);
        return upload(
          token,
          eightMbPng,
          `large-${index}.png`,
          'image/png',
          key,
        );
      });

      const responses = await Promise.all(busyUploadPromises);

      for (const res of responses) {
        expect(res.status).toBe(503);
        expect(res.header['retry-after']).toBe('1');
        expect(res.header['connection']).toBe('close');
        expect(res.body).toMatchObject({
          error: {
            code: 'MEDIA_INGESTION_BUSY',
            message: 'Media ingestion service is busy. Please try again later.',
          },
        });
      }
    } finally {
      barrier.release();
    }

    const upload1Response = await upload1Promise;
    expect(upload1Response.status).toBe(201);
    expect(upload1Response.body.data.media.id).toBeDefined();

    // Xác nhận không có dòng MediaIngestion nào được tạo cho các request 503
    const busyIngestions = await prisma.mediaIngestion.findMany({
      where: {
        idempotencyKeyHash: { in: busyKeys.map(hashKey) },
      },
    });
    expect(busyIngestions).toHaveLength(0);
  });

  it('preserves in-flight ingestion when client disconnects, retains slot during processing, and replays idempotently on retry', async () => {
    await prisma.mediaUploadRateLimit.deleteMany();
    const barrier = scanner.blockNextScan();
    const idempotencyKey = `idemp-disconnect-${randomUUID()}`;

    const testReq = upload(
      adminToken,
      png,
      'disconnect.png',
      'image/png',
      idempotencyKey,
    );
    testReq.end(() => {});

    // Chờ request 1 gửi xong body và scanner bắt đầu scan
    await barrier.started;

    // Client ngắt kết nối sau khi đã gửi đủ body
    testReq.abort();

    // Trong khi request 1 vẫn đang xử lý, slot concurrency = 1 vẫn bị giữ
    await prisma.mediaUploadRateLimit.deleteMany();
    const upload2Key = `upload-during-hold-${randomUUID()}`;
    const upload2Response = await upload(
      adminToken2,
      png,
      'second.png',
      'image/png',
      upload2Key,
    );

    expect(upload2Response.status).toBe(503);
    expect(upload2Response.header['retry-after']).toBe('1');
    expect(upload2Response.body).toMatchObject({
      error: {
        code: 'MEDIA_INGESTION_BUSY',
      },
    });

    // Giải phóng barrier để ingestion 1 tiếp tục xử lý
    barrier.release();

    // Chờ ingestion 1 hoàn thành trong database
    let ingestion1: { status: string; mediaId: number | null } | null = null;
    for (let i = 0; i < 50; i++) {
      ingestion1 = await prisma.mediaIngestion.findFirst({
        where: { idempotencyKeyHash: hashKey(idempotencyKey) },
        select: { status: true, mediaId: true },
      });
      if (ingestion1?.status === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(ingestion1?.status).toBe('completed');
    expect(ingestion1?.mediaId).toBeDefined();
    const originalMediaId = ingestion1!.mediaId;

    // Retry upload 1 với CÙNG Idempotency-Key
    await prisma.mediaUploadRateLimit.deleteMany();
    const retryResponse = await upload(
      adminToken,
      png,
      'disconnect.png',
      'image/png',
      idempotencyKey,
    );

    expect(retryResponse.status).toBe(201);
    expect(retryResponse.body.data.idempotent).toBe(true);
    expect(retryResponse.body.data.media.id).toBe(originalMediaId);

    // Xác nhận request 503 không tạo MediaIngestion nào
    const busyIngestions = await prisma.mediaIngestion.findMany({
      where: { idempotencyKeyHash: hashKey(upload2Key) },
    });
    expect(busyIngestions).toHaveLength(0);
  });

  it('rejects 5 slow 8 MiB uploads with 503 MEDIA_INGESTION_BUSY without ECONNRESET/EPIPE while slot is held', async () => {
    // Tự gọi http.request thay vì supertest để tuỳ chỉnh chunking và sleep
    const boundary = '----SlowUploadBoundary' + randomUUID();
    const preamble = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="slow.png"\r\nContent-Type: image/png\r\n\r\n`;
    const postamble = `\r\n--${boundary}--\r\n`;
    const preambleBuf = Buffer.from(preamble);
    const postambleBuf = Buffer.from(postamble);
    const chunkCount = 128; // 128 chunks * 64KB = 8MB
    const chunkSize = 64 * 1024;
    const bodyLength =
      preambleBuf.length + chunkCount * chunkSize + postambleBuf.length;

    const doSlowUpload = async (token: string, key: string) => {
      return new Promise<{ status: number; body: unknown }>(
        (resolve, reject) => {
          const port = app.getHttpServer().address().port;
          const req = http.request(
            {
              hostname: '127.0.0.1',
              port,
              path: `/api/v1/admin/cms/media/ingestions?dataSourceId=${sourceId}`,
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Idempotency-Key': key,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': bodyLength.toString(),
              },
              agent: false,
            },
            (res: http.IncomingMessage) => {
              let data = '';
              res.on('data', (chunk: Buffer) => {
                data += chunk.toString();
              });
              res.on('end', () => {
                try {
                  if (!errorOccurred) {
                    resolve({
                      status: res.statusCode ?? 500,
                      body: JSON.parse(data),
                    });
                  }
                } catch {
                  if (!errorOccurred) {
                    reject(new Error(`Failed to parse response body: ${data}`));
                  }
                }
              });
            },
          );

          let errorOccurred = false;
          req.on('error', (err: Error) => {
            errorOccurred = true;
            reject(err);
          });

          const writeBody = async () => {
            try {
              req.write(preambleBuf);
              const zeros = Buffer.alloc(chunkSize, 0);
              for (let i = 0; i < chunkCount; i++) {
                if (errorOccurred) return;
                req.write(zeros);
                await new Promise((r) => setTimeout(r, 2));
              }
              if (!errorOccurred) req.end(postambleBuf);
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          };

          writeBody().catch(() => {});
        },
      );
    };

    const tokens: string[] = [];
    for (let i = 0; i < 5; i++) {
      tokens.push(await createAdmin(i + 10));
    }
    await prisma.mediaUploadRateLimit.deleteMany();

    const barrier = scanner.blockNextScan();
    const upload1Promise = new Promise<request.Response>((resolve, reject) => {
      upload(
        adminToken,
        png,
        'held.png',
        'image/png',
        `media-concurrency-held-slow-${randomUUID()}`,
      ).end((err, res) => {
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
        else resolve(res);
      });
    });

    try {
      await barrier.started;
      for (let i = 0; i < 5; i++) {
        const key = `media-busy-slow-${i}-${randomUUID()}`;
        const res = await doSlowUpload(tokens[i], key);
        expect(res.status).toBe(503);
        const body = res.body as { error?: { code?: string } };
        expect(body.error?.code).toBe('MEDIA_INGESTION_BUSY');
      }
    } finally {
      barrier.release();
    }
    await upload1Promise;
  });

  it('clears slot and leaves no MediaIngestion when client aborts mid-upload', async () => {
    await prisma.mediaUploadRateLimit.deleteMany();
    const boundary = '----AbortBoundary' + randomUUID();
    const preamble = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="abort.png"\r\nContent-Type: image/png\r\n\r\n`;
    const postamble = `\r\n--${boundary}--\r\n`;
    const preambleBuf = Buffer.from(preamble);
    const totalChunks = 200;
    const chunkSize = 64 * 1024;
    const bodyLength =
      preambleBuf.length +
      totalChunks * chunkSize +
      Buffer.from(postamble).length;
    const abortKey = `abort-mid-upload-${randomUUID()}`;

    await new Promise<void>((resolve) => {
      const port = (app.getHttpServer().address() as { port: number }).port;
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: `/api/v1/admin/cms/media/ingestions?dataSourceId=${sourceId}`,
          method: 'POST',
          headers: {
            Authorization: `Bearer ${adminToken}`,
            'Idempotency-Key': abortKey,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': bodyLength.toString(),
          },
          agent: false,
        },
        () => {},
      );

      let resolved = false;
      const finish = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };
      req.on('error', finish);
      req.on('close', finish);

      // Write preamble and a few chunks, then abort
      req.write(preambleBuf);
      const chunk = Buffer.alloc(chunkSize, 0);
      let written = 0;
      const writeAndAbort = () => {
        if (written >= 5) {
          req.destroy();
          return;
        }
        req.write(chunk, () => {
          written++;
          setTimeout(writeAndAbort, 10);
        });
      };
      writeAndAbort();
    });

    // (a) Ngay sau đó, một upload hợp lệ nhận 201 (slot đã được trả)
    const deadline = Date.now() + 2000;
    let nextUploadRes: request.Response | null = null;
    while (Date.now() < deadline) {
      await prisma.mediaUploadRateLimit.deleteMany();
      const validKey = `valid-after-abort-${randomUUID()}`;
      nextUploadRes = await upload(
        adminToken,
        png,
        'valid-after-abort.png',
        'image/png',
        validKey,
      );
      if (nextUploadRes.status === 201) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(nextUploadRes?.status).toBe(201);

    // (b) Không có dòng MediaIngestion nào ứng với Idempotency-Key của request bị huỷ
    const abortedIngestion = await prisma.mediaIngestion.findFirst({
      where: { idempotencyKeyHash: hashKey(abortKey) },
    });
    expect(abortedIngestion).toBeNull();
  });

  function hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

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

  async function createAdmin(index: number): Promise<string> {
    const email = `concurrency-adm-${index}-${suffix}@example.com`;
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password })
      .expect(201);
    const userId = reg.body.data.user.id as number;
    await prisma.user.update({
      where: { id: userId },
      data: { role: 'admin' },
    });
    return login(email);
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
