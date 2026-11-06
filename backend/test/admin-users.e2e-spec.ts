/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import {
  JOB_NAMES,
  JobQueuePort,
} from '../src/infrastructure/jobs/job-queue.port';
import { InMemoryJobQueue } from '../src/infrastructure/jobs/in-memory-job-queue.adapter';
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
  let inMemoryQueue: InMemoryJobQueue;

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

    const queuePort = app.get<JobQueuePort>(JobQueuePort);
    expect(queuePort).toBeInstanceOf(InMemoryJobQueue);
    inMemoryQueue = queuePort as InMemoryJobQueue;

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

  describe('POST /admin/users/:id/deletion-request', () => {
    type AdminDeletionResponse = {
      requestId: number;
      scheduledAt: string;
      initiatedBy: 'admin';
    };

    const requestDeletion = (
      targetId: number,
      body: Record<string, unknown> = { reason: 'under_age' },
    ) =>
      asAdmin('post', `/api/v1/admin/users/${targetId}/deletion-request`).send(
        body,
      );

    const deletionAuditRows = (targetId: number) =>
      prisma.auditLog.findMany({
        where: {
          action: 'account.deletion_requested_by_admin',
          targetId: String(targetId),
        },
        orderBy: { id: 'asc' },
      });

    beforeAll(async () => {
      for (const label of [
        'del_target',
        'del_suspended',
        'del_escalate',
        'del_replay',
        'del_due',
        'del_suspended_admin',
      ]) {
        await register(label);
      }

      await prisma.user.update({
        where: { id: id('del_suspended') },
        data: { status: 'suspended' },
      });
      await prisma.user.update({
        where: { id: id('del_suspended_admin') },
        data: { role: 'admin', status: 'suspended' },
      });
      await prisma.user.update({
        where: { id: id('del_due') },
        data: { status: 'deletion_pending', deletedAt: new Date() },
      });
      await prisma.accountDeletionRequest.create({
        data: {
          userId: id('del_due'),
          status: 'requested',
          initiatedBy: 'user',
          verifiedAt: new Date(),
          scheduledAt: new Date(Date.now() - 60 * 60_000),
        },
      });
    });

    beforeEach(() => {
      inMemoryQueue.clear();
    });

    it('rejects unauthenticated and non-admin callers', async () => {
      await http()
        .post(`/api/v1/admin/users/${id('del_target')}/deletion-request`)
        .send({ reason: 'under_age' })
        .expect(401);

      const forbidden = await http()
        .post(`/api/v1/admin/users/${id('del_target')}/deletion-request`)
        // learner_search kept role `user` throughout this spec; learner_primary
        // is promoted to admin by the role-change suite above.
        .set('Authorization', `Bearer ${token('learner_search')}`)
        .send({ reason: 'under_age' })
        .expect(403);
      expect((forbidden.body as ErrorBody).error.code).toBe('FORBIDDEN');
    });

    it('validates the path id and the body', async () => {
      await asAdmin('post', '/api/v1/admin/users/0/deletion-request')
        .send({ reason: 'under_age' })
        .expect(400);

      const target = `/api/v1/admin/users/${id('del_target')}/deletion-request`;
      await asAdmin('post', target).send({ reason: 'spam' }).expect(400);
      await asAdmin('post', target).send({}).expect(400);
      await asAdmin('post', target)
        .send({ reason: 'under_age', note: 'PO approved' })
        .expect(400);
    });

    it('returns 404 for unknown and anonymized targets', async () => {
      const missing = await requestDeletion(2_000_000_000).expect(404);
      expect((missing.body as ErrorBody).error.code).toBe('USER_NOT_FOUND');

      const anonymized = await requestDeletion(id('anonymized_user')).expect(
        404,
      );
      expect((anonymized.body as ErrorBody).error.code).toBe('USER_NOT_FOUND');
    });

    it('creates the request, revokes sessions, drops tokens, enqueues 2 jobs and audits', async () => {
      const userId = id('del_target');
      await prisma.passwordResetToken.create({
        data: {
          userId,
          tokenHash: `${prefix}-del-target-reset-token`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      await prisma.emailVerificationToken.create({
        data: {
          userId,
          tokenHash: `${prefix}-del-target-verify-token`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });

      const correlationId = '9d1d0b1e-6f1e-4c3a-8c6e-6d0f7f4c2a11';
      const before = Date.now();
      const response = await requestDeletion(userId)
        .set('x-request-id', correlationId)
        .expect('cache-control', 'no-store')
        .expect(201);

      const data = (response.body as { data: AdminDeletionResponse }).data;
      expect(data.initiatedBy).toBe('admin');
      const scheduledAt = new Date(data.scheduledAt);
      const days = (scheduledAt.getTime() - before) / 86_400_000;
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThan(7.1);

      const request = await prisma.accountDeletionRequest.findUniqueOrThrow({
        where: { id: data.requestId },
      });
      expect(request).toMatchObject({
        userId,
        status: 'requested',
        initiatedBy: 'admin',
        actorId: id('admin_actor'),
        reason: 'under_age',
      });
      expect(request.scheduledAt?.toISOString()).toBe(
        scheduledAt.toISOString(),
      );

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      expect(user.status).toBe('deletion_pending');
      expect(user.deletedAt).not.toBeNull();

      expect(
        await prisma.userSession.count({
          where: { userId, revokedAt: null },
        }),
      ).toBe(0);
      expect(await prisma.passwordResetToken.count({ where: { userId } })).toBe(
        0,
      );
      expect(
        await prisma.emailVerificationToken.count({ where: { userId } }),
      ).toBe(0);

      const anonymizeJobs = inMemoryQueue.getJobsByName(
        JOB_NAMES.ANONYMIZE_ACCOUNT,
      );
      expect(anonymizeJobs).toHaveLength(1);
      expect(anonymizeJobs[0].data).toEqual({ requestId: data.requestId });
      expect(anonymizeJobs[0].options?.singletonKey).toBe(
        `anonymize:${data.requestId}`,
      );
      expect(anonymizeJobs[0].options?.startAfter).toBeDefined();

      const mailJobs = inMemoryQueue.getJobsByName(
        JOB_NAMES.SEND_ACCOUNT_DELETION_SCHEDULED,
      );
      expect(mailJobs).toHaveLength(1);
      expect(mailJobs[0].data).toEqual({ requestId: data.requestId });
      expect(mailJobs[0].options?.singletonKey).toBe(
        `deletion-mail:${data.requestId}`,
      );

      const audits = await deletionAuditRows(userId);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        actorId: id('admin_actor'),
        targetType: 'user',
        targetId: String(userId),
        correlationId,
        beforeSummary: { status: 'active' },
      });
      expect(audits[0].afterSummary).toMatchObject({
        requestId: data.requestId,
        initiatedBy: 'admin',
        reason: 'under_age',
        escalated: false,
      });
    });

    it('replays idempotently without a second row, job or audit row', async () => {
      const userId = id('del_replay');
      const first = await requestDeletion(userId).expect(201);
      const firstData = (first.body as { data: AdminDeletionResponse }).data;
      expect(inMemoryQueue.getJobs()).toHaveLength(2);
      inMemoryQueue.clear();

      const second = await requestDeletion(userId).expect(201);
      const secondData = (second.body as { data: AdminDeletionResponse }).data;

      expect(secondData.requestId).toBe(firstData.requestId);
      expect(new Date(secondData.scheduledAt).toISOString()).toBe(
        new Date(firstData.scheduledAt).toISOString(),
      );
      expect(secondData.initiatedBy).toBe('admin');

      expect(inMemoryQueue.getJobs()).toHaveLength(0);
      expect(
        await prisma.accountDeletionRequest.count({ where: { userId } }),
      ).toBe(1);
      expect(await deletionAuditRows(userId)).toHaveLength(1);
    });

    it('escalates a user-initiated request in place, keeps scheduledAt and sends the correction mail', async () => {
      const userId = id('del_escalate');
      const self = await http()
        .post('/api/v1/users/me/deletion-request')
        .set('Authorization', `Bearer ${token('del_escalate')}`)
        .send({ password })
        .expect(202);
      const selfData = (
        self.body as { data: { requestId: number; scheduledAt: string } }
      ).data;
      inMemoryQueue.clear();

      const response = await requestDeletion(userId).expect(201);
      const data = (response.body as { data: AdminDeletionResponse }).data;

      expect(data.requestId).toBe(selfData.requestId);
      expect(new Date(data.scheduledAt).toISOString()).toBe(
        new Date(selfData.scheduledAt).toISOString(),
      );

      const rows = await prisma.accountDeletionRequest.findMany({
        where: { userId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: selfData.requestId,
        status: 'requested',
        initiatedBy: 'admin',
        actorId: id('admin_actor'),
        reason: 'under_age',
      });
      expect(rows[0].scheduledAt?.toISOString()).toBe(
        new Date(selfData.scheduledAt).toISOString(),
      );

      // The anonymize job from the self-service request is not enqueued again.
      expect(
        inMemoryQueue.getJobsByName(JOB_NAMES.ANONYMIZE_ACCOUNT),
      ).toHaveLength(0);
      const mailJobs = inMemoryQueue.getJobsByName(
        JOB_NAMES.SEND_ACCOUNT_DELETION_SCHEDULED,
      );
      expect(mailJobs).toHaveLength(1);
      expect(mailJobs[0].options?.singletonKey).toBe(
        `deletion-mail:${selfData.requestId}:admin`,
      );

      const audits = await deletionAuditRows(userId);
      expect(audits).toHaveLength(1);
      // F1: the escalation records who owned the request before it was
      // escalated, and never the user's free-text reason (PII).
      expect(audits[0].beforeSummary).toEqual({
        status: 'deletion_pending',
        initiatedBy: 'user',
      });
      expect(JSON.stringify(audits[0].beforeSummary)).not.toContain('reason');
      expect(audits[0].afterSummary).toMatchObject({
        requestId: selfData.requestId,
        initiatedBy: 'admin',
        reason: 'under_age',
        escalated: true,
      });
    });

    it('rejects targeting yourself', async () => {
      const response = await requestDeletion(id('admin_actor')).expect(409);
      expect((response.body as ErrorBody).error.code).toBe(
        'ADMIN_SELF_ACTION_FORBIDDEN',
      );
    });

    it('allows targeting a suspended user', async () => {
      const userId = id('del_suspended');
      const response = await requestDeletion(userId).expect(201);
      const data = (response.body as { data: AdminDeletionResponse }).data;
      expect(data.initiatedBy).toBe('admin');

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      expect(user.status).toBe('deletion_pending');
      const request = await prisma.accountDeletionRequest.findUniqueOrThrow({
        where: { id: data.requestId },
      });
      expect(request.initiatedBy).toBe('admin');
      expect(await deletionAuditRows(userId)).toHaveLength(1);
    });

    it('rejects a requested deletion that is already due', async () => {
      const response = await requestDeletion(id('del_due')).expect(409);
      expect((response.body as ErrorBody).error.code).toBe(
        'USER_DELETION_ALREADY_DUE',
      );
      expect(
        await prisma.accountDeletionRequest.count({
          where: { userId: id('del_due') },
        }),
      ).toBe(1);
    });

    it('rejects deleting the last admin seat', async () => {
      // Earlier suites promote learners and suspend admins, so snapshot every
      // other admin instead of assuming a fixed cast. The target stays admin.
      const demoted = await prisma.user.findMany({
        where: {
          role: 'admin',
          id: { notIn: [id('admin_actor'), id('del_suspended_admin')] },
        },
        select: { id: true },
      });
      const demotedIds = demoted.map((row) => row.id);
      try {
        await prisma.user.updateMany({
          where: { id: { in: demotedIds } },
          data: { role: 'user' },
        });
        const response = await requestDeletion(
          id('del_suspended_admin'),
        ).expect(409);
        expect((response.body as ErrorBody).error.code).toBe(
          'LAST_ADMIN_REQUIRED',
        );
      } finally {
        await prisma.user.updateMany({
          where: { id: { in: demotedIds } },
          data: { role: 'admin' },
        });
      }
    });

    it('rejects an actor that lost admin rights after the roles guard', async () => {
      await prisma.user.update({
        where: { id: id('admin_peer') },
        data: { role: 'user' },
      });
      try {
        const response = await http()
          .post(`/api/v1/admin/users/${id('del_suspended')}/deletion-request`)
          .set('Authorization', `Bearer ${token('admin_peer')}`)
          .send({ reason: 'under_age' })
          .expect(403);
        expect((response.body as ErrorBody).error.code).toBe('FORBIDDEN');
      } finally {
        await prisma.user.update({
          where: { id: id('admin_peer') },
          data: { role: 'admin' },
        });
      }
    });
  });
});
