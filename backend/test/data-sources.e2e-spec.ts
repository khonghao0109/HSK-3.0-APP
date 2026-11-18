/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { Prisma } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

/**
 * M5.1b2 (TL-26/TL-30): GET /admin/cms/data-sources là list admin chỉ đọc cho
 * trang Nhập dữ liệu, và route nhập bài tập giữ giới hạn body JSON mặc định
 * 100 KB của Nest (payload ~110 KB → 413 trước khi vào validation/DB).
 */
describe('Admin data sources và giới hạn body import (M5.1b2) E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let normalToken: string;
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const password = 'StrongPassword123!';
  const createdDataSourceIds: number[] = [];
  const sharedName = `Data source order ${suffix}`;
  const uniqueName = `Data source unique ${suffix}`;
  const mediaName = `Data source media ${suffix}`;

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
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);

    async function register(label: string) {
      const email = `data-sources-${label}-${suffix}@example.com`;
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password, name: `Data sources ${label}` })
        .expect(201);
      return {
        userId: response.body.data.user.id as number,
        token: response.body.data.accessToken as string,
      };
    }

    const normal = await register('normal');
    normalToken = normal.token;
    const admin = await register('admin');
    await prisma.user.update({
      where: { id: admin.userId },
      data: { role: 'admin' },
    });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: `data-sources-admin-${suffix}@example.com`,
        password,
      })
      .expect(201);
    adminToken = login.body.data.accessToken as string;

    const fixtures = [
      { code: `DS_ORDER_${suffix}_V2`, name: sharedName, version: 'v2' },
      { code: `DS_ORDER_${suffix}_V10`, name: sharedName, version: 'v10' },
      { code: `DS_ORDER_${suffix}_V1`, name: sharedName, version: 'v1' },
      { code: `DS_UNIQUE_${suffix}`, name: uniqueName, version: 'v1' },
    ];
    for (const fixture of fixtures) {
      const created = await prisma.dataSource.create({
        data: {
          code: fixture.code,
          name: fixture.name,
          version: fixture.version,
          // Các field này không bao giờ được lộ ra list admin.
          license: 'test-only-license',
          notes: 'test-only-notes',
          contentHash: `hash-${fixture.code}`,
        },
        select: { id: true },
      });
      createdDataSourceIds.push(created.id);
    }
    // Q103: license NULL / blank never owns media; the rest of the row is valid.
    for (const [version, license] of [
      ['v3', 'approved-license'],
      ['v2', null],
      ['v1', '   '],
    ] as const) {
      const created = await prisma.dataSource.create({
        data: {
          code: `DS_MEDIA_${suffix}_${version}`,
          name: mediaName,
          version,
          license,
        },
        select: { id: true },
      });
      createdDataSourceIds.push(created.id);
    }
  });

  afterAll(async () => {
    if (createdDataSourceIds.length > 0) {
      await prisma.dataSource.deleteMany({
        where: { id: { in: createdDataSourceIds } },
      });
    }
    await app.close();
  });

  function listDataSources(query = '') {
    return request(app.getHttpServer()).get(
      `/api/v1/admin/cms/data-sources${query}`,
    );
  }

  it('1. protects the data source list with authentication and admin RBAC', async () => {
    await listDataSources().expect(401);
    await listDataSources()
      .set('Authorization', `Bearer ${normalToken}`)
      .expect(403);
  });

  it('2. returns exactly id/code/name/version per item and hides provenance fields', async () => {
    const response = await listDataSources('?page=1&limit=100')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.success).toBe(true);
    // Envelope admin bọc phân trang trong `meta.pagination` (A.1).
    expect(response.body.meta.pagination).toMatchObject({
      page: 1,
      limit: 100,
    });
    expect(response.body.meta.pagination.total).toBeGreaterThanOrEqual(
      createdDataSourceIds.length,
    );
    expect(typeof response.body.meta.requestId).toBe('string');
    const fixtureItems = (
      response.body.data as Record<string, unknown>[]
    ).filter((item) => String(item.code).includes(suffix));
    expect(fixtureItems).toHaveLength(createdDataSourceIds.length);
    for (const item of fixtureItems) {
      expect(Object.keys(item).sort()).toEqual([
        'code',
        'id',
        'name',
        'version',
      ]);
    }
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('test-only-license');
    expect(serialized).not.toContain('test-only-notes');
    expect(serialized).not.toContain(`hash-DS_ORDER_${suffix}_V1`);
    expect(serialized).not.toContain('createdById');
  });

  it('3. orders by name asc, version desc, id asc deterministically', async () => {
    const response = await listDataSources('?page=1&limit=100')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const all = response.body.data as {
      id: number;
      code: string;
      name: string;
      version: string;
    }[];
    const expected = await prisma.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT id FROM "DataSource" ORDER BY name ASC, version DESC, id ASC LIMIT 100`,
    );
    expect(all.map((item) => item.id)).toEqual(expected.map((item) => item.id));
    const relative = all
      .filter((item) => item.name === sharedName)
      .map((item) => item.version);
    // "v10" đứng trước "v2" theo version desc của Postgres (so chuỗi).
    expect(relative).toEqual(['v2', 'v10', 'v1']);
    const sharedIndexes = all
      .map((item, index) => (item.name === sharedName ? index : -1))
      .filter((index) => index >= 0);
    expect(sharedIndexes).toHaveLength(3);
    const uniqueIndex = all.findIndex((item) => item.name === uniqueName);
    expect(uniqueIndex).toBeGreaterThan(Math.max(...sharedIndexes));
  });

  it('4. validates pagination bounds (limit=101, page=0, limit=0 → 400)', async () => {
    await listDataSources('?page=1&limit=101')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
    await listDataSources('?page=0&limit=20')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
    await listDataSources('?page=1&limit=0')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  it('5. fails closed with 413 for an import body larger than the 100 KB JSON limit', async () => {
    const bigText = 'x'.repeat(110_000);
    const payload = {
      dataSourceId: createdDataSourceIds[0],
      fileName: `oversize-${suffix}.json`,
      rows: [
        {
          sourceKey: `oversize-${suffix}`,
          lessonId: 1,
          topicId: null,
          orderIndex: 1,
          type: 'fill_blank',
          prompt: 'Điền từ',
          content: {},
          answer: { acceptedTexts: ['a'] },
          explanation: bigText,
        },
      ],
    };
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/cms/exercise-imports/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload);
    expect(response.status).toBe(413);
    expect(JSON.stringify(response.body)).not.toContain(bigText.slice(0, 32));
  });

  it('6. eligibleFor=media keeps only sources media finalize accepts (Q103/TL-35)', async () => {
    const codesOf = (body: { data: { code: string }[] }) =>
      body.data.filter((item) => item.code.startsWith(`DS_MEDIA_${suffix}`));

    const all = await listDataSources('?page=1&limit=100')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(codesOf(all.body).map((item) => item.code)).toEqual([
      `DS_MEDIA_${suffix}_v3`,
      `DS_MEDIA_${suffix}_v2`,
      `DS_MEDIA_${suffix}_v1`,
    ]);

    const eligible = await listDataSources(
      '?page=1&limit=100&eligibleFor=media',
    )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const media = codesOf(eligible.body);
    expect(media).toHaveLength(1);
    expect(Object.keys(media[0] ?? {}).sort()).toEqual([
      'code',
      'id',
      'name',
      'version',
    ]);
    expect(media[0]).toMatchObject({
      code: `DS_MEDIA_${suffix}_v3`,
      name: mediaName,
      version: 'v3',
    });
    const [{ total }] = await prisma.$queryRaw<{ total: number }[]>(
      Prisma.sql`SELECT count(*)::int AS total FROM "DataSource"
        WHERE NULLIF(btrim(license), '') IS NOT NULL
          AND NULLIF(btrim(code), '') IS NOT NULL
          AND NULLIF(btrim(version), '') IS NOT NULL`,
    );
    expect(eligible.body.meta.pagination.total).toBe(total);
    expect(eligible.body.meta.pagination.total).toBeLessThan(
      all.body.meta.pagination.total,
    );

    const firstPage = await listDataSources('?page=1&limit=1&eligibleFor=media')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(firstPage.body.data).toHaveLength(1);
    expect(firstPage.body.meta.pagination).toMatchObject({
      page: 1,
      limit: 1,
      total,
      totalPages: total,
    });

    await listDataSources('?eligibleFor=lesson')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });
});
