/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const userEmail = `e2e_user_${Date.now()}@example.com`;
  const adminEmail = `e2e_admin_${Date.now()}@example.com`;
  const password = 'Test123!';

  beforeAll(async () => {
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
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: [userEmail, adminEmail] } },
    });
    await app.close();
  });

  it('register -> login -> me should work', async () => {
    const registerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: userEmail, password, name: 'E2E User' })
      .expect(201);

    expect(registerRes.body).toHaveProperty('accessToken');

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: userEmail, password })
      .expect(201);

    expect(loginRes.body).toHaveProperty('accessToken');
    const token = loginRes.body.accessToken as string;

    const meRes = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(meRes.body.user.email).toBe(userEmail);
  });

  it('GET /users with user role should return 403', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: userEmail, password })
      .expect(201);

    const userToken = loginRes.body.accessToken as string;

    await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('GET /users with admin role should return 200', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: adminEmail, password, name: 'E2E Admin' })
      .expect(201);

    await prisma.user.update({
      where: { email: adminEmail },
      data: { role: 'admin' },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password })
      .expect(201);

    const adminToken = loginRes.body.accessToken as string;

    const usersRes = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(usersRes.body)).toBe(true);
  });
});
