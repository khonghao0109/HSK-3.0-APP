import { Controller, Get, type INestApplication, Req } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import request from 'supertest';

import { configureTrustProxy } from '../../config/runtime-security';
import { AuthController } from '../../modules/auth/auth.controller';
import { AuthService } from '../../modules/auth/auth.service';

import { CustomThrottlerGuard } from './custom-throttler.guard';

const JWT_SECRET = 'unit-test-throttler-jwt-secret-32-characters';
const LIMIT = 2;

@Controller()
class ProbeController {
  @Get('probe')
  probe(@Req() req: Request) {
    return { ip: req.ip };
  }
}

async function createApp(trustProxyHops = 1): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        ignoreEnvFile: true,
        load: [
          () => ({
            app: { trustProxyHops },
            jwt: { secrets: { v1: JWT_SECRET }, activeKid: 'v1' },
          }),
        ],
      }),
      ThrottlerModule.forRoot([{ ttl: 60_000, limit: LIMIT }]),
    ],
    controllers: [ProbeController, AuthController],
    providers: [
      { provide: APP_GUARD, useClass: CustomThrottlerGuard },
      {
        provide: AuthService,
        useValue: { login: jest.fn(), register: jest.fn() },
      },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureTrustProxy(app, app.get(ConfigService));
  // Bind once on loopback. Otherwise supertest listens on `::` per request and
  // on macOS may reach another local process holding the same port on 127.0.0.1.
  await app.listen(0, '127.0.0.1');
  return app;
}

function token(
  sub: number,
  options: { secret?: string; kid?: string; expiresIn?: number } = {},
) {
  return new JwtService().sign(
    { sub, email: `user${sub}@example.com`, role: 'user' },
    {
      secret: options.secret ?? JWT_SECRET,
      expiresIn: options.expiresIn ?? 60,
      header: { kid: options.kid ?? 'v1', alg: 'HS256' },
    },
  );
}

describe('CustomThrottlerGuard', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  const probe = (forwardedFor: string, bearer?: string) => {
    const call = request(app.getHttpServer())
      .get('/probe')
      .set('X-Forwarded-For', forwardedFor);
    return bearer ? call.set('Authorization', `Bearer ${bearer}`) : call;
  };

  async function exhaust(forwardedFor: string, bearer?: string) {
    for (let hit = 0; hit < LIMIT; hit += 1) {
      await probe(forwardedFor, bearer).expect(200);
    }
    await probe(forwardedFor, bearer).expect(429);
  }

  describe('trust proxy', () => {
    it('resolves req.ip to the address appended by the trusted proxy', async () => {
      app = await createApp();

      const response = await probe('203.0.113.9, 198.51.100.2').expect(200);

      expect(response.body).toEqual({ ip: '198.51.100.2' });
    });

    it('ignores X-Forwarded-For when no proxy hop is trusted', async () => {
      app = await createApp(0);

      const response = await probe('198.51.100.2').expect(200);

      expect(response.body.ip).not.toBe('198.51.100.2');
      expect(response.body.ip).toMatch(/127\.0\.0\.1|::1/u);
    });
  });

  describe('anonymous requests', () => {
    it('limits each forwarded client IP separately behind a shared proxy', async () => {
      app = await createApp();

      await exhaust('198.51.100.2');

      await probe('198.51.100.3').expect(200);
    });

    it('cannot escape the IP bucket by prepending a forged address', async () => {
      app = await createApp();

      await exhaust('198.51.100.2');

      await probe('10.9.9.9, 198.51.100.2').expect(429);
    });
  });

  describe('authenticated requests', () => {
    it('limits each verified user separately on the same client IP', async () => {
      app = await createApp();

      await exhaust('198.51.100.2', token(7));

      await probe('198.51.100.2', token(8)).expect(200);
      await probe('198.51.100.2').expect(200);
    });

    it('keeps the user bucket when the user changes IP', async () => {
      app = await createApp();

      await exhaust('198.51.100.2', token(7));

      await probe('198.51.100.4', token(7)).expect(429);
    });

    it.each([
      ['a wrong signature', () => token(7, { secret: 'x'.repeat(44) })],
      ['an unknown kid', () => token(7, { kid: 'constructor' })],
      ['an expired token', () => token(7, { expiresIn: -60 })],
      ['a non-JWT bearer', () => 'not-a-jwt'],
    ])('falls back to the IP bucket for %s', async (_label, bearer) => {
      app = await createApp();

      await exhaust('198.51.100.2', bearer());

      await probe('198.51.100.2').expect(429);
      await probe('198.51.100.2', token(7)).expect(200);
    });

    it.each([
      ['login', 200],
      ['register', 100],
    ])(
      'keeps POST /auth/%s on the IP bucket despite valid tokens',
      async (route, routeLimit) => {
        app = await createApp();
        const call = (sub: number) =>
          request(app.getHttpServer())
            .post(`/auth/${route}`)
            .set('X-Forwarded-For', '198.51.100.2')
            .set('Authorization', `Bearer ${token(sub)}`);

        for (let sub = 1; sub <= routeLimit; sub += 1) {
          await call(sub).expect(201);
        }

        await call(routeLimit + 1).expect(429);
      },
    );
  });

  describe('getTracker', () => {
    class ExposedGuard extends CustomThrottlerGuard {
      track(req: Record<string, unknown>) {
        return this.getTracker(req);
      }
    }

    it.each([
      [{ user: { id: 123 }, ip: '203.0.113.1' }, 'user:123'],
      [{ ip: '203.0.113.1' }, 'ip:203.0.113.1'],
      [{ user: { id: '123' }, ip: '203.0.113.1' }, 'ip:203.0.113.1'],
    ])('tracks %j as %s', async (req, expected) => {
      app = await createApp();
      const guard = new ExposedGuard(
        [],
        { increment: jest.fn() },
        {} as never,
        app.get(ConfigService),
      );

      await expect(guard.track(req)).resolves.toBe(expected);
    });
  });
});
