/// <reference types="jest" />

import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { HealthService } from '../src/modules/health/health.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';
import { apiError, envelopeMeta } from './utils/api-envelope';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe('Global response envelope (e2e)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    assertDisposableTestDatabase();
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: createSafeValidationException,
      }),
    );
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('wraps a success and echoes the request id in header and meta', async () => {
    const response = await http().get('/api/v1/health').expect(200);
    const requestId = response.headers['x-request-id'];

    expect(requestId).toMatch(UUID_V4);
    expect(response.body).toEqual({
      success: true,
      data: { database: 'connected', env: 'test', port: expect.any(Number) },
      meta: { requestId, timestamp: expect.any(String) },
    });
    expect(Number.isNaN(Date.parse(response.body.meta.timestamp))).toBe(false);
  });

  it.each([
    ['a client UUID', '7d1f4a9e-3b2c-4d5e-8f60-1a2b3c4d5e6f'],
    ['an nginx $request_id', '0123456789abcdef0123456789abcdef'],
  ])('keeps %s', async (_, incoming) => {
    const response = await http()
      .get('/api/v1/health')
      .set('x-request-id', incoming)
      .expect(200);

    expect(response.headers['x-request-id']).toBe(incoming);
    expect(response.body.meta.requestId).toBe(incoming);
  });

  it('replaces an unusable incoming id instead of reflecting it', async () => {
    const response = await http()
      .get('/api/v1/health')
      .set('x-request-id', '<script>alert(1)</script>')
      .expect(200);

    expect(response.headers['x-request-id']).toMatch(UUID_V4);
    expect(response.text).not.toContain('script');
  });

  it('wraps guard rejections that happen before any handler runs', async () => {
    const response = await http()
      .get('/api/v1/users/me')
      .set('x-request-id', '7d1f4a9e-3b2c-4d5e-8f60-1a2b3c4d5e6f')
      .expect(401);

    expect(response.body).toEqual(
      apiError({ code: 'UNAUTHORIZED', message: 'Unauthorized' }),
    );
    expect(response.body.meta.requestId).toBe(
      '7d1f4a9e-3b2c-4d5e-8f60-1a2b3c4d5e6f',
    );
  });

  it('keeps validation details under error.details', async () => {
    const response = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email', password: 'x', extra: true })
      .expect(400);

    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'REQUEST_VALIDATION_FAILED',
        message: 'Request validation failed.',
        details: { errors: expect.any(Array) as unknown },
      },
      meta: envelopeMeta(),
    });
  });

  it('does not reflect a malformed JSON body', async () => {
    const response = await http()
      .post('/api/v1/auth/login')
      .set('content-type', 'application/json')
      .send('{"email":"a@example.com","password":hunter2-secret}')
      .expect(400);

    expect(response.body).toEqual(
      apiError({
        code: 'MALFORMED_REQUEST',
        message: 'Request body or path could not be parsed.',
      }),
    );
    expect(response.text).not.toContain('hunter2');
  });

  it('answers an oversized JSON body with the envelope', async () => {
    const response = await http()
      .post('/api/v1/auth/login')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ email: 'a'.repeat(200_000) }))
      .expect(413);

    expect(response.body).toEqual(
      apiError({ code: 'PAYLOAD_TOO_LARGE', message: 'Payload Too Large' }),
    );
  });

  it('answers unknown routes without echoing the query string', async () => {
    const response = await http()
      .get('/api/v1/does-not-exist?signature=secret-capability')
      .expect(404);

    expect(response.body).toEqual(
      apiError({
        code: 'NOT_FOUND',
        message: 'Cannot GET /api/v1/does-not-exist',
      }),
    );
    expect(response.headers['x-request-id']).toMatch(UUID_V4);
  });

  it('hides unexpected failures behind a generic 500', async () => {
    const leak = 'SELECT password FROM "User" WHERE email = secret@example.com';
    const check = jest
      .spyOn(HealthService.prototype, 'checkDatabase')
      .mockRejectedValue(new Error(leak));
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    try {
      const response = await http().get('/api/v1/health').expect(500);

      expect(response.body).toEqual(
        apiError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Internal server error.',
        }),
      );
      expect(response.text).not.toContain('secret@example.com');
      expect(JSON.stringify(logError.mock.calls)).not.toContain('SELECT');
      expect(logError).toHaveBeenCalledWith(
        `Unhandled Error (requestId=${response.headers['x-request-id']})`,
      );
    } finally {
      check.mockRestore();
      logError.mockRestore();
    }
  });
});
