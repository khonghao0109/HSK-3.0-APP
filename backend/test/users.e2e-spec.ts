/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

type UserItem = {
  id: number;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
};

describe('Users E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

  const prefix = `e2e_users_${Date.now()}`;
  const password = 'Test123!';
  const emailFor = (label: string) => `${prefix}_${label}@example.com`;
  const http = () => request(app.getHttpServer());

  const register = async (label: string): Promise<string> => {
    const response = await http()
      .post('/api/v1/auth/register')
      .send({ email: emailFor(label), password })
      .expect(201);
    return response.body.accessToken as string;
  };

  const listUsers = (query = '') =>
    http()
      .get(`/api/v1/users${query}`)
      .set('Authorization', `Bearer ${adminToken}`);

  /** Ground truth from the database, serialized like the HTTP response. */
  const visibleUsers = async (): Promise<UserItem[]> =>
    (
      await prisma.user.findMany({
        where: { deletedAt: null },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
        },
      })
    ).map((user) => ({ ...user, createdAt: user.createdAt.toISOString() }));

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
        transformOptions: { enableImplicitConversion: true },
        exceptionFactory: createSafeValidationException,
      }),
    );
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);

    adminToken = await register('admin');
    await prisma.user.update({
      where: { email: emailFor('admin') },
      data: { role: 'admin' },
    });

    const deletedAt = new Date();
    await prisma.user.createMany({
      data: [
        { email: emailFor('visible_1'), password: 'unused', name: 'One' },
        {
          email: emailFor('anonymized'),
          password: 'unused',
          status: 'anonymized',
          deletedAt,
        },
        {
          email: emailFor('suspended'),
          password: 'unused',
          status: 'suspended',
        },
        {
          email: emailFor('pending'),
          password: 'unused',
          status: 'deletion_pending',
          deletedAt,
        },
        { email: emailFor('visible_2'), password: 'unused' },
      ],
    });
  });

  afterAll(async () => {
    await prisma?.user.deleteMany({ where: { email: { startsWith: prefix } } });
    await app?.close();
  });

  it('walks every user that is not soft-deleted exactly once, in id order', async () => {
    const expected = await visibleUsers();
    const limit = 100;
    const totalPages = Math.ceil(expected.length / limit);
    const seen: UserItem[] = [];

    for (let page = 1; page <= totalPages; page += 1) {
      const { body } = await listUsers(`?page=${page}&limit=${limit}`).expect(
        200,
      );
      expect(body).toMatchObject({
        total: expected.length,
        page,
        limit,
        totalPages,
      });
      seen.push(...(body.items as UserItem[]));
    }

    expect(seen).toEqual(expected);
    const emails = seen.map((user) => user.email);
    expect(emails).toEqual(
      expect.arrayContaining([
        emailFor('visible_1'),
        emailFor('visible_2'),
        emailFor('suspended'),
      ]),
    );
    expect(emails).not.toContain(emailFor('anonymized'));
    expect(emails).not.toContain(emailFor('pending'));
    await expect(prisma.user.count()).resolves.toBeGreaterThan(expected.length);
    for (const user of seen) {
      expect(Object.keys(user).sort()).toEqual([
        'createdAt',
        'email',
        'id',
        'name',
        'role',
      ]);
    }
  });

  it('slices pages by page and limit, and returns an empty page past the end', async () => {
    const expected = await visibleUsers();
    const limit = 2;
    const totalPages = Math.ceil(expected.length / limit);

    expect(totalPages).toBeGreaterThan(1);
    for (const page of [1, totalPages - 1, totalPages, totalPages + 1]) {
      const { body } = await listUsers(`?page=${page}&limit=${limit}`).expect(
        200,
      );
      expect(body).toEqual({
        items: expected.slice((page - 1) * limit, page * limit),
        total: expected.length,
        page,
        limit,
        totalPages,
      });
    }
    const { body: lastAllowed } = await listUsers(
      '?page=2147483647&limit=100',
    ).expect(200);
    expect(lastAllowed).toMatchObject({ items: [], page: 2147483647 });
  });

  it('defaults to page 1 with 20 users', async () => {
    const expected = await visibleUsers();

    const { body } = await listUsers().expect(200);

    expect(body).toEqual({
      items: expected.slice(0, 20),
      total: expected.length,
      page: 1,
      limit: 20,
      totalPages: Math.ceil(expected.length / 20),
    });
  });

  it.each([
    ['limit above 100', '?limit=101'],
    ['zero limit', '?limit=0'],
    ['zero page', '?page=0'],
    ['negative page', '?page=-1'],
    ['fractional page', '?page=1.5'],
    ['non-numeric page', '?page=abc'],
    ['page above the int4 range', '?page=2147483648'],
    ['page beyond the database offset range', '?page=1e20'],
    ['unknown parameter', '?sort=email'],
  ])('rejects a %s with 400', async (_label, query) => {
    const { body } = await listUsers(query).expect(400);

    expect(body).toMatchObject({ code: 'REQUEST_VALIDATION_FAILED' });
  });

  it('keeps GET /users admin-only', async () => {
    const userToken = await register('learner');

    await http()
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
    await http().get('/api/v1/users').expect(401);
  });

  it('stops serving /users/me once the account is soft-deleted', async () => {
    const token = await register('leaving');

    const { body: profile } = await http()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Object.keys(profile as UserItem).sort()).toEqual([
      'createdAt',
      'email',
      'id',
      'name',
      'role',
    ]);
    expect(profile).toMatchObject({ email: emailFor('leaving') });

    await prisma.user.update({
      where: { email: emailFor('leaving') },
      data: { status: 'anonymized', deletedAt: new Date() },
    });

    const { body } = await http()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    expect(JSON.stringify(body)).not.toContain(emailFor('leaving'));
    // The newest account sorts last, so it would be on the last page.
    const { body: first } = await listUsers('?limit=100').expect(200);
    const { body: last } = await listUsers(
      `?page=${first.totalPages as number}&limit=100`,
    ).expect(200);
    expect(last.total).toBe(
      await prisma.user.count({ where: { deletedAt: null } }),
    );
    expect((last.items as UserItem[]).map((user) => user.id)).not.toContain(
      (profile as UserItem).id,
    );
  });
});
