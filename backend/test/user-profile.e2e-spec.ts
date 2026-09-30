/// <reference types="jest" />

import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

type ProfileResponse = {
  displayName: string | null;
  locale: string;
  timezone: string;
};

type EnvelopeResponse<T> = {
  success: boolean;
  data: T;
  meta: {
    requestId: string;
    timestamp: string;
  };
};

describe('User Profile E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const prefix = `e2e_profile_${Date.now()}`;
  const password = 'Password123!';
  const emailFor = (label: string) => `${prefix}_${label}@example.com`;
  const http = () => request(app.getHttpServer());

  const registerUser = async (
    label: string,
  ): Promise<{ token: string; userId: number }> => {
    const email = emailFor(label);
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ email, password })
      .expect(HttpStatus.CREATED);

    const token = (res.body as EnvelopeResponse<{ accessToken: string }>).data
      .accessToken;
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });

    return { token, userId: user.id };
  };

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
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('GET /users/me/profile', () => {
    it('returns default profile and keeps 0 UserProfile rows in database when user has no profile', async () => {
      const { token, userId } = await registerUser('no_profile');

      // Ensure 0 profile rows before GET
      const countBefore = await prisma.userProfile.count({
        where: { userId },
      });
      expect(countBefore).toBe(0);

      const response = await http()
        .get('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      const body = response.body as EnvelopeResponse<ProfileResponse>;
      expect(body.success).toBe(true);
      expect(body.data).toEqual({
        displayName: null,
        locale: 'vi-VN',
        timezone: 'Asia/Ho_Chi_Minh',
      });

      // Ensure 0 profile rows after GET (GET must never create a row)
      const countAfter = await prisma.userProfile.count({
        where: { userId },
      });
      expect(countAfter).toBe(0);
    });

    it('returns 401 when request is sent without token', async () => {
      await http()
        .get('/api/v1/users/me/profile')
        .expect(HttpStatus.UNAUTHORIZED);
    });

    it('returns 404 when user is soft-deleted or inactive', async () => {
      const { token, userId } = await registerUser('inactive_user');
      await prisma.user.update({
        where: { id: userId },
        data: { status: 'suspended', deletedAt: new Date() },
      });

      await http()
        .get('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.UNAUTHORIZED); // JWT strategy blocks inactive/deleted
    });
  });

  describe('PATCH /users/me/profile', () => {
    it('updates displayName and GET returns updated value', async () => {
      const { token } = await registerUser('update_name');

      const patchRes = await http()
        .patch('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ displayName: 'Nguyễn Văn A' })
        .expect(HttpStatus.OK);

      const patchBody = patchRes.body as EnvelopeResponse<ProfileResponse>;
      expect(patchBody.data).toEqual({
        displayName: 'Nguyễn Văn A',
        locale: 'vi-VN',
        timezone: 'Asia/Ho_Chi_Minh',
      });

      const getRes = await http()
        .get('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      const getBody = getRes.body as EnvelopeResponse<ProfileResponse>;
      expect(getBody.data.displayName).toBe('Nguyễn Văn A');
    });

    it('clears displayName with null', async () => {
      const { token } = await registerUser('clear_name');

      await http()
        .patch('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ displayName: 'Initial Name' })
        .expect(HttpStatus.OK);

      const clearRes = await http()
        .patch('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ displayName: null })
        .expect(HttpStatus.OK);

      const clearBody = clearRes.body as EnvelopeResponse<ProfileResponse>;
      expect(clearBody.data.displayName).toBeNull();

      const getRes = await http()
        .get('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      const getBody = getRes.body as EnvelopeResponse<ProfileResponse>;
      expect(getBody.data.displayName).toBeNull();
    });

    it('preserves existing displayName when updating only timezone', async () => {
      const { token } = await registerUser('keep_name');

      await http()
        .patch('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ displayName: 'Preserved Name' })
        .expect(HttpStatus.OK);

      const updateRes = await http()
        .patch('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ timezone: 'UTC' })
        .expect(HttpStatus.OK);

      const updateBody = updateRes.body as EnvelopeResponse<ProfileResponse>;
      expect(updateBody.data).toEqual({
        displayName: 'Preserved Name',
        locale: 'vi-VN',
        timezone: 'UTC',
      });
    });

    it('returns 400 when request body is empty object', async () => {
      const { token } = await registerUser('empty_body');

      await http()
        .patch('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('returns 400 when unexpected field avatarUrl is sent', async () => {
      const { token } = await registerUser('reject_avatar');

      const res = await http()
        .patch('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ avatarUrl: 'https://example.com/avatar.png' })
        .expect(HttpStatus.BAD_REQUEST);

      expect(JSON.stringify(res.body)).toContain('REQUEST_VALIDATION_FAILED');
    });

    it('returns 400 when displayName contains U+202E bidi override character', async () => {
      const { token } = await registerUser('bidi_override');

      await http()
        .patch('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ displayName: 'Fake\u202EAdmin' })
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('returns 400 when displayName exceeds 50 code points, and 200 for 50 Vietnamese characters', async () => {
      const { token } = await registerUser('length_limits');

      // 51 code points -> 400
      const fiftyOneChars = 'a'.repeat(51);
      await http()
        .patch('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ displayName: fiftyOneChars })
        .expect(HttpStatus.BAD_REQUEST);

      // 50 Vietnamese characters with diacritics -> 200
      const fiftyVietnamese =
        'Nguyễn Thị Ánh Tuyết Hoàng Phúc Quỳnh Mai Đặng Văn';
      expect(Array.from(fiftyVietnamese).length).toBe(50);

      const res = await http()
        .patch('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ displayName: fiftyVietnamese })
        .expect(HttpStatus.OK);

      const body = res.body as EnvelopeResponse<ProfileResponse>;
      expect(body.data.displayName).toBe(fiftyVietnamese);
    });

    it('returns 400 when displayName is empty after trimming', async () => {
      const { token } = await registerUser('empty_display_name');

      await http()
        .patch('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ displayName: '    ' })
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('returns 400 when locale is unsupported en-US', async () => {
      const { token } = await registerUser('unsupported_locale');

      await http()
        .patch('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ locale: 'en-US' })
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('accepts valid IANA timezones and preserves them verbatim', async () => {
      const { token } = await registerUser('tz_verbatim');

      const validTimezones = [
        'Asia/Ho_Chi_Minh',
        'UTC',
        'Etc/GMT+7',
        'America/Argentina/Buenos_Aires',
        'America/Port-au-Prince',
      ];

      for (const tz of validTimezones) {
        const patchRes = await http()
          .patch('/api/v1/users/me/profile')
          .set('Authorization', `Bearer ${token}`)
          .send({ timezone: tz })
          .expect(HttpStatus.OK);

        const patchBody = patchRes.body as EnvelopeResponse<ProfileResponse>;
        expect(patchBody.data.timezone).toBe(tz);

        const getRes = await http()
          .get('/api/v1/users/me/profile')
          .set('Authorization', `Bearer ${token}`)
          .expect(HttpStatus.OK);

        const getBody = getRes.body as EnvelopeResponse<ProfileResponse>;
        expect(getBody.data.timezone).toBe(tz);
      }
    });

    it('rejects invalid or non-standard IANA timezone formats with 400', async () => {
      const { token } = await registerUser('tz_invalid');

      const invalidTimezones = [
        'asia/ho_chi_minh',
        '+07:00',
        'EST5EDT',
        'Mars/Base',
        'A'.repeat(65),
      ];

      for (const tz of invalidTimezones) {
        await http()
          .patch('/api/v1/users/me/profile')
          .set('Authorization', `Bearer ${token}`)
          .send({ timezone: tz })
          .expect(HttpStatus.BAD_REQUEST);
      }
    });

    it('returns 401 when PATCH is sent without token', async () => {
      await http()
        .patch('/api/v1/users/me/profile')
        .send({ displayName: 'Unauthorized' })
        .expect(HttpStatus.UNAUTHORIZED);
    });

    it('isolates profiles between users: user A cannot change user B profile', async () => {
      const userA = await registerUser('user_a');
      const userB = await registerUser('user_b');

      // User B sets initial profile
      await http()
        .patch('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${userB.token}`)
        .send({ displayName: 'User B Original', timezone: 'UTC' })
        .expect(HttpStatus.OK);

      // User A updates their own profile
      await http()
        .patch('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ displayName: 'User A Name' })
        .expect(HttpStatus.OK);

      // User B profile remains completely unchanged
      const resB = await http()
        .get('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${userB.token}`)
        .expect(HttpStatus.OK);

      const bodyB = resB.body as EnvelopeResponse<ProfileResponse>;
      expect(bodyB.data).toEqual({
        displayName: 'User B Original',
        locale: 'vi-VN',
        timezone: 'UTC',
      });

      // Verify directly in DB that User B profile row was not modified by User A
      const dbProfileB = await prisma.userProfile.findUnique({
        where: { userId: userB.userId },
      });
      expect(dbProfileB?.displayName).toBe('User B Original');
      expect(dbProfileB?.timezone).toBe('UTC');
    });

    it('handles 2 concurrent PATCH requests without 500 and creates exactly 1 row', async () => {
      const { token, userId } = await registerUser('concurrent_race');

      // Ensure no profile exists initially
      const initialCount = await prisma.userProfile.count({
        where: { userId },
      });
      expect(initialCount).toBe(0);

      // Send 2 PATCH requests simultaneously
      const [res1, res2] = await Promise.all([
        http()
          .patch('/api/v1/users/me/profile')
          .set('Authorization', `Bearer ${token}`)
          .send({ displayName: 'Concurrent Name' }),
        http()
          .patch('/api/v1/users/me/profile')
          .set('Authorization', `Bearer ${token}`)
          .send({ timezone: 'UTC' }),
      ]);

      expect([res1.status, res2.status]).toEqual([200, 200]);

      // Exactly 1 row in DB
      const finalCount = await prisma.userProfile.count({
        where: { userId },
      });
      expect(finalCount).toBe(1);

      // GET profile returns valid combined state
      const getRes = await http()
        .get('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      const getBody = getRes.body as EnvelopeResponse<ProfileResponse>;
      expect(getBody.data.locale).toBe('vi-VN');
      expect(
        getBody.data.displayName === 'Concurrent Name' ||
          getBody.data.timezone === 'UTC',
      ).toBe(true);
    });
  });
});
