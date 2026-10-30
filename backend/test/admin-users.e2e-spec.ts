/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

type AdminUser = {
  id: number;
  email: string;
  name: string | null;
  role: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
};

type AuditActor = { id: number; name: string | null; email: string };

type AuditLog = {
  id: string;
  createdAt: string;
  action: string;
  actor: AuditActor | null;
  targetType: string;
  targetId: string | null;
  target: { email: string } | null;
  reason: string | null;
  roleChange: { from: string; to: string } | null;
};

type ErrorBody = {
  success: false;
  error: { code: string; message: string };
  meta: { requestId: string };
};

const ADMIN_USER_KEYS = [
  'id',
  'email',
  'name',
  'role',
  'status',
  'lastLoginAt',
  'createdAt',
].sort();

describe('Admin users E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const prefix = `e2e_admin_users_${Date.now()}`;
  const password = 'Test123!';
  const emailFor = (label: string) => `${prefix}_${label}@example.com`;
  const http = () => request(app.getHttpServer());

  const ids = new Map<string, number>();
  const tokens = new Map<string, string>();

  const register = async (label: string) => {
    const response = await http()
      .post('/api/v1/auth/register')
      .send({ email: emailFor(label), password })
      .expect(201);
    ids.set(label, response.body.data.user.id as number);
    tokens.set(label, response.body.data.accessToken as string);
  };

  const id = (label: string): number => {
    const value = ids.get(label);
    if (value === undefined) throw new Error(`Missing seeded user ${label}`);
    return value;
  };

  const token = (label: string): string => {
    const value = tokens.get(label);
    if (value === undefined) throw new Error(`Missing seeded token ${label}`);
    return value;
  };

  const asAdmin = (method: 'get' | 'post' | 'patch', path: string) =>
    http()
      [method](path)
      .set('Authorization', `Bearer ${token('admin_actor')}`);

  const listUsers = (query = '') =>
    asAdmin('get', `/api/v1/admin/users${query}`);

  const listAuditLogs = (query = '') =>
    asAdmin('get', `/api/v1/admin/audit-logs${query}`);

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

    for (const label of [
      'admin_actor',
      'admin_peer',
      'admin_suspend',
      'learner_primary',
      'learner_suspend',
      'learner_search',
      'suspended_user',
      'pending_user',
      'anonymized_user',
    ]) {
      await register(label);
    }

    await prisma.user.updateMany({
      where: {
        id: { in: [id('admin_actor'), id('admin_peer'), id('admin_suspend')] },
      },
      data: { role: 'admin', name: 'Quản trị viên kiểm thử' },
    });
    await prisma.user.update({
      where: { id: id('learner_search') },
      data: { name: '100% Admin' },
    });
    await prisma.user.update({
      where: { id: id('suspended_user') },
      data: { status: 'suspended' },
    });
    await prisma.user.update({
      where: { id: id('pending_user') },
      data: { status: 'deletion_pending', deletedAt: new Date() },
    });
    await prisma.user.update({
      where: { id: id('anonymized_user') },
      data: { status: 'anonymized', deletedAt: new Date() },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('authorization', () => {
    it('rejects unauthenticated and non-admin callers', async () => {
      await http().get('/api/v1/admin/users').expect(401);

      const forbidden = await http()
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${token('learner_primary')}`)
        .expect(403);
      expect((forbidden.body as ErrorBody).error.code).toBe('FORBIDDEN');

      await http()
        .get('/api/v1/admin/audit-logs')
        .set('Authorization', `Bearer ${token('learner_primary')}`)
        .expect(403);
      await http()
        .patch(`/api/v1/admin/users/${id('learner_primary')}/role`)
        .set('Authorization', `Bearer ${token('learner_primary')}`)
        .send({ role: 'admin' })
        .expect(403);
    });
  });

  describe('GET /admin/users', () => {
    it('lists users with no-store, exact fields and pagination meta', async () => {
      const response = await listUsers(`?q=${encodeURIComponent(prefix)}`)
        .expect('cache-control', 'no-store')
        .expect(200);

      const body = response.body as {
        success: boolean;
        data: AdminUser[];
        meta: {
          pagination: {
            page: number;
            limit: number;
            total: number;
            totalPages: number;
          };
        };
      };
      expect(body.success).toBe(true);
      expect(body.meta.pagination.page).toBe(1);
      expect(body.meta.pagination.limit).toBe(20);
      expect(body.meta.pagination.total).toBe(7);
      expect(body.meta.pagination.totalPages).toBe(1);

      for (const user of body.data) {
        expect(Object.keys(user).sort()).toEqual(ADMIN_USER_KEYS);
        expect(JSON.stringify(user)).not.toContain(password);
        expect(user).not.toHaveProperty('password');
        expect(user).not.toHaveProperty('failedLoginAttempts');
        expect(user).not.toHaveProperty('lockUntil');
      }
    });

    it('orders by createdAt desc then id desc', async () => {
      const expected = await prisma.user.findMany({
        where: {
          email: { startsWith: prefix },
          deletedAt: null,
          status: { not: 'anonymized' },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      const response = await listUsers(
        `?q=${encodeURIComponent(prefix)}`,
      ).expect(200);
      const actual = (response.body.data as AdminUser[]).map((user) => user.id);
      expect(actual).toEqual(expected.map((user) => user.id));
    });

    it('paginates the filtered list', async () => {
      const response = await listUsers(
        `?q=${encodeURIComponent(prefix)}&page=2&limit=3`,
      ).expect(200);
      const body = response.body as {
        data: AdminUser[];
        meta: {
          pagination: {
            page: number;
            limit: number;
            total: number;
            totalPages: number;
          };
        };
      };
      expect(body.data).toHaveLength(3);
      expect(body.meta.pagination).toMatchObject({
        page: 2,
        limit: 3,
        total: 7,
        totalPages: 3,
      });
    });

    it('hides anonymized and soft-deleted rows by default, shows deletion_pending on request', async () => {
      const defaultList = await listUsers(
        `?q=${encodeURIComponent(prefix)}`,
      ).expect(200);
      const defaultIds = (defaultList.body.data as AdminUser[]).map(
        (user) => user.id,
      );
      expect(defaultIds).not.toContain(id('pending_user'));
      expect(defaultIds).not.toContain(id('anonymized_user'));

      const pendingList = await listUsers(
        `?q=${encodeURIComponent(prefix)}&status=deletion_pending`,
      ).expect(200);
      const pending = pendingList.body.data as AdminUser[];
      expect(pending.map((user) => user.id)).toEqual([id('pending_user')]);
      expect(pending[0]?.status).toBe('deletion_pending');
    });

    it('filters by role', async () => {
      const response = await listUsers(
        `?q=${encodeURIComponent(prefix)}&role=admin`,
      ).expect(200);
      const users = response.body.data as AdminUser[];
      expect(users.length).toBeGreaterThanOrEqual(3);
      expect(users.every((user) => user.role === 'admin')).toBe(true);
    });

    it('searches email and name with escaped ILIKE metacharacters', async () => {
      const byEmail = await listUsers(
        `?q=${encodeURIComponent(emailFor('learner_primary'))}`,
      ).expect(200);
      expect((byEmail.body.data as AdminUser[]).map((user) => user.id)).toEqual(
        [id('learner_primary')],
      );

      const literalPercent = await listUsers('?q=100%25').expect(200);
      expect(
        (literalPercent.body.data as AdminUser[]).map((user) => user.id),
      ).toEqual([id('learner_search')]);

      // An unescaped `_` would match every single character; escaped it is literal.
      const literalUnderscore = await listUsers('?q=100_').expect(200);
      expect(literalUnderscore.body.data as AdminUser[]).toEqual([]);
    });

    it('validates filters', async () => {
      await listUsers('?role=teacher').expect(400);
      await listUsers('?status=anonymized').expect(400);
      await listUsers(`?q=${'x'.repeat(101)}`).expect(400);
      await listUsers('?unknown=1').expect(400);
    });
  });

  describe('PATCH /admin/users/:id/role', () => {
    const auditRows = (targetId: number) =>
      prisma.auditLog.findMany({
        where: { action: 'user.role_changed', targetId: String(targetId) },
        orderBy: { id: 'asc' },
      });

    it('promotes a learner, writes audit in the same transaction and keeps correlation id', async () => {
      const requestId = '3f2504e0-4f89-41d3-9a0c-0305e82c33a1';
      const response = await asAdmin(
        'patch',
        `/api/v1/admin/users/${id('learner_primary')}/role`,
      )
        .set('x-request-id', requestId)
        .send({ role: 'admin' })
        .expect('cache-control', 'no-store')
        .expect(200);

      const body = response.body as {
        data: AdminUser;
        meta: { requestId: string };
      };
      expect(body.data.role).toBe('admin');
      expect(body.meta.requestId).toBe(requestId);

      const rows = await auditRows(id('learner_primary'));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'user.role_changed',
        targetType: 'user',
        targetId: String(id('learner_primary')),
        actorId: id('admin_actor'),
        correlationId: requestId,
        beforeSummary: { role: 'user' },
        afterSummary: { role: 'admin' },
      });
      expect(rows[0]?.ipAddress).toBeNull();
      expect(rows[0]?.userAgent).toBeNull();
    });

    it('returns 200 without a second audit row when the role is unchanged', async () => {
      const before = await auditRows(id('learner_primary'));
      await asAdmin(
        'patch',
        `/api/v1/admin/users/${id('learner_primary')}/role`,
      )
        .send({ role: 'admin' })
        .expect(200);
      expect(await auditRows(id('learner_primary'))).toHaveLength(
        before.length,
      );
    });

    it('rejects changing your own role', async () => {
      const response = await asAdmin(
        'patch',
        `/api/v1/admin/users/${id('admin_actor')}/role`,
      )
        .send({ role: 'user' })
        .expect(409);
      expect((response.body as ErrorBody).error.code).toBe(
        'ADMIN_SELF_ACTION_FORBIDDEN',
      );
    });

    it('rejects deletion_pending and anonymized targets', async () => {
      const pending = await asAdmin(
        'patch',
        `/api/v1/admin/users/${id('pending_user')}/role`,
      )
        .send({ role: 'admin' })
        .expect(409);
      expect((pending.body as ErrorBody).error.code).toBe(
        'USER_NOT_MODIFIABLE',
      );

      const anonymized = await asAdmin(
        'patch',
        `/api/v1/admin/users/${id('anonymized_user')}/role`,
      )
        .send({ role: 'admin' })
        .expect(404);
      expect((anonymized.body as ErrorBody).error.code).toBe('USER_NOT_FOUND');

      await asAdmin('patch', '/api/v1/admin/users/2147483647/role')
        .send({ role: 'admin' })
        .expect(404);
    });

    it('validates path id and body', async () => {
      await asAdmin('patch', '/api/v1/admin/users/0/role')
        .send({ role: 'admin' })
        .expect(400);
      await asAdmin(
        'patch',
        `/api/v1/admin/users/${id('learner_primary')}/role`,
      )
        .send({ role: 'teacher' })
        .expect(400);
      await asAdmin(
        'patch',
        `/api/v1/admin/users/${id('learner_primary')}/role`,
      )
        .send({ role: 'user', extra: true })
        .expect(400);
      await asAdmin(
        'patch',
        `/api/v1/admin/users/${id('learner_primary')}/role`,
      )
        .send({})
        .expect(400);
    });

    it('can change the role of a suspended user', async () => {
      const promote = await asAdmin(
        'patch',
        `/api/v1/admin/users/${id('suspended_user')}/role`,
      )
        .send({ role: 'admin' })
        .expect(200);
      expect((promote.body as { data: AdminUser }).data).toMatchObject({
        role: 'admin',
        status: 'suspended',
      });

      const demote = await asAdmin(
        'patch',
        `/api/v1/admin/users/${id('suspended_user')}/role`,
      )
        .send({ role: 'user' })
        .expect(200);
      expect((demote.body as { data: AdminUser }).data.role).toBe('user');
    });
  });

  describe('POST /admin/users/:id/suspend', () => {
    it('suspends an active user, revokes every session and writes audit', async () => {
      const requestId = '3f2504e0-4f89-41d3-9a0c-0305e82c33a2';
      const response = await asAdmin(
        'post',
        `/api/v1/admin/users/${id('learner_suspend')}/suspend`,
      )
        .set('x-request-id', requestId)
        .send({ reason: '  Spam links  ' })
        .expect('cache-control', 'no-store')
        .expect(201);

      const body = response.body as { data: AdminUser };
      expect(body.data).toMatchObject({ status: 'suspended' });
      expect(body.data).not.toHaveProperty('password');

      const sessions = await prisma.userSession.findMany({
        where: { userId: id('learner_suspend') },
        select: { revokedAt: true },
      });
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.every((session) => session.revokedAt !== null)).toBe(
        true,
      );

      // The old access token is useless immediately: the session is revoked and
      // the account is no longer active.
      await http()
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${token('learner_suspend')}`)
        .expect(401);

      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'user.suspended',
          targetId: String(id('learner_suspend')),
        },
        orderBy: { id: 'desc' },
      });
      expect(audit).toMatchObject({
        targetType: 'user',
        actorId: id('admin_actor'),
        correlationId: requestId,
        beforeSummary: { status: 'active' },
        afterSummary: { status: 'suspended', reason: 'Spam links' },
      });
      expect(audit?.ipAddress).toBeNull();
      expect(audit?.userAgent).toBeNull();
    });

    it('rejects suspending yourself', async () => {
      const response = await asAdmin(
        'post',
        `/api/v1/admin/users/${id('admin_actor')}/suspend`,
      )
        .send({ reason: 'self' })
        .expect(409);
      expect((response.body as ErrorBody).error.code).toBe(
        'ADMIN_SELF_ACTION_FORBIDDEN',
      );
    });

    it('rejects users that are not active', async () => {
      const suspended = await asAdmin(
        'post',
        `/api/v1/admin/users/${id('suspended_user')}/suspend`,
      )
        .send({ reason: 'again' })
        .expect(409);
      expect((suspended.body as ErrorBody).error.code).toBe('USER_NOT_ACTIVE');

      const pending = await asAdmin(
        'post',
        `/api/v1/admin/users/${id('pending_user')}/suspend`,
      )
        .send({ reason: 'pending' })
        .expect(409);
      expect((pending.body as ErrorBody).error.code).toBe('USER_NOT_ACTIVE');

      await asAdmin(
        'post',
        `/api/v1/admin/users/${id('anonymized_user')}/suspend`,
      )
        .send({ reason: 'gone' })
        .expect(404);
    });

    it('validates the reason', async () => {
      const cases: unknown[] = [
        {},
        { reason: '' },
        { reason: '   ' },
        { reason: 'x'.repeat(501) },
        { reason: 42 },
        { reason: 'ok', extra: true },
      ];
      for (const payload of cases) {
        await asAdmin('post', `/api/v1/admin/users/${id('admin_peer')}/suspend`)
          .send(payload as object)
          .expect(400);
      }
    });

    it('suspends an active admin while another active admin remains', async () => {
      const response = await asAdmin(
        'post',
        `/api/v1/admin/users/${id('admin_suspend')}/suspend`,
      )
        .send({ reason: 'Admin offboarding' })
        .expect(201);
      expect((response.body as { data: AdminUser }).data.status).toBe(
        'suspended',
      );

      await http()
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${token('admin_suspend')}`)
        .expect(401);
    });
  });

  describe('POST /admin/users/:id/unsuspend', () => {
    it('reactivates a suspended user and writes audit', async () => {
      const requestId = '3f2504e0-4f89-41d3-9a0c-0305e82c33a3';
      const response = await asAdmin(
        'post',
        `/api/v1/admin/users/${id('suspended_user')}/unsuspend`,
      )
        .set('x-request-id', requestId)
        .expect('cache-control', 'no-store')
        .expect(201);

      expect((response.body as { data: AdminUser }).data).toMatchObject({
        status: 'active',
      });

      const audit = await prisma.auditLog.findFirst({
        where: {
          action: 'user.unsuspended',
          targetId: String(id('suspended_user')),
        },
        orderBy: { id: 'desc' },
      });
      expect(audit).toMatchObject({
        actorId: id('admin_actor'),
        correlationId: requestId,
        beforeSummary: { status: 'suspended' },
        afterSummary: { status: 'active' },
      });
    });

    it('rejects users that are not suspended', async () => {
      const active = await asAdmin(
        'post',
        `/api/v1/admin/users/${id('learner_search')}/unsuspend`,
      ).expect(409);
      expect((active.body as ErrorBody).error.code).toBe('USER_NOT_SUSPENDED');

      const pending = await asAdmin(
        'post',
        `/api/v1/admin/users/${id('pending_user')}/unsuspend`,
      ).expect(409);
      expect((pending.body as ErrorBody).error.code).toBe('USER_NOT_SUSPENDED');

      await asAdmin(
        'post',
        `/api/v1/admin/users/${id('anonymized_user')}/unsuspend`,
      ).expect(404);
    });
  });

  describe('GET /admin/audit-logs', () => {
    it('lists audit rows without IP, user agent or raw summaries', async () => {
      const response = await listAuditLogs('?page=1&limit=100')
        .expect('cache-control', 'no-store')
        .expect(200);
      const body = response.body as {
        data: AuditLog[];
        meta: { pagination: { total: number } };
      };
      expect(body.meta.pagination.total).toBeGreaterThanOrEqual(3);

      for (const row of body.data) {
        expect(typeof row.id).toBe('string');
        expect(row).not.toHaveProperty('ipAddress');
        expect(row).not.toHaveProperty('userAgent');
        expect(row).not.toHaveProperty('beforeSummary');
        expect(row).not.toHaveProperty('afterSummary');
        expect(Object.keys(row).sort()).toEqual(
          [
            'action',
            'actor',
            'createdAt',
            'id',
            'reason',
            'roleChange',
            'target',
            'targetId',
            'targetType',
          ].sort(),
        );
      }
    });

    it('returns the role transition and target email for a role change', async () => {
      const response = await listAuditLogs(
        `?targetType=user&targetId=${id('learner_primary')}`,
      ).expect(200);
      const rows = response.body.data as AuditLog[];
      const roleChange = rows.find((row) => row.action === 'user.role_changed');
      expect(roleChange).toMatchObject({
        actor: {
          id: id('admin_actor'),
          email: emailFor('admin_actor'),
        },
        targetType: 'user',
        targetId: String(id('learner_primary')),
        target: { email: emailFor('learner_primary') },
        reason: null,
        roleChange: { from: 'user', to: 'admin' },
      });
    });

    it('returns the suspension reason only for user.suspended', async () => {
      const response = await listAuditLogs(
        `?targetType=user&targetId=${id('learner_suspend')}`,
      ).expect(200);
      const rows = response.body.data as AuditLog[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'user.suspended',
        reason: 'Spam links',
        roleChange: null,
        target: { email: emailFor('learner_suspend') },
      });
    });

    it('renders a missing actor as null and an anonymized target as null', async () => {
      await prisma.auditLog.create({
        data: {
          actorId: null,
          action: 'account.deletion_requested',
          targetType: 'User',
          targetId: String(id('anonymized_user')),
        },
      });

      const response = await listAuditLogs(
        `?targetType=User&targetId=${id('anonymized_user')}`,
      ).expect(200);
      const rows = response.body.data as AuditLog[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'account.deletion_requested',
        actor: null,
        targetType: 'User',
        targetId: String(id('anonymized_user')),
        target: null,
        reason: null,
        roleChange: null,
      });
    });

    it('filters and paginates', async () => {
      const empty = await listAuditLogs('?targetType=nothing').expect(200);
      expect(empty.body.data).toEqual([]);

      const page = await listAuditLogs('?limit=2&page=1').expect(200);
      const body = page.body as {
        data: AuditLog[];
        meta: {
          pagination: { page: number; limit: number; totalPages: number };
        };
      };
      expect(body.data.length).toBeLessThanOrEqual(2);
      expect(body.meta.pagination).toMatchObject({ page: 1, limit: 2 });
    });
  });
});
