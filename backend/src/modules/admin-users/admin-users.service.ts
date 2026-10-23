import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ApiSuccessResponse } from '../../common/interfaces/api-response.interface';
import { escapeLike } from '../../common/utils/sql-pattern';
import { PrismaService } from '../../prisma/prisma.service';

import {
  ADMIN_USERS_ADVISORY_LOCK_KEY,
  type AdminRole,
  type AdminUserStatus,
} from './admin-users.policy';
import { AdminUserDto } from './dto/admin-user-response.dto';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';

export type AdminUserActor = { id: number; role: string };

/** TL-66: audit correlation id comes from the request id the client saw. */
export type AdminUserMutationContext = { correlationId: string };

const ADMIN_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type AdminUserRecord = Prisma.UserGetPayload<{
  select: typeof ADMIN_USER_SELECT;
}>;

type ActingAdminRow = {
  id: number;
  role: string;
  status: string;
  deletedAt: Date | null;
};

type AdminUserSearchRow = {
  id: number;
  email: string;
  name: string | null;
  role: string;
  status: string;
  lastLoginAt: Date | null;
  createdAt: Date;
};

function assertAdminActor(actor: AdminUserActor): void {
  if (actor.role !== 'admin') {
    throw new ForbiddenException('Insufficient role.');
  }
}

function userNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'USER_NOT_FOUND',
    message: 'User not found.',
  });
}

function selfActionForbidden(): ConflictException {
  return new ConflictException({
    code: 'ADMIN_SELF_ACTION_FORBIDDEN',
    message: 'Admins cannot perform this action on their own account.',
  });
}

function userNotModifiable(): ConflictException {
  return new ConflictException({
    code: 'USER_NOT_MODIFIABLE',
    message: 'Only active or suspended users can be modified.',
  });
}

function userNotActive(): ConflictException {
  return new ConflictException({
    code: 'USER_NOT_ACTIVE',
    message: 'Only an active user can be suspended.',
  });
}

function userNotSuspended(): ConflictException {
  return new ConflictException({
    code: 'USER_NOT_SUSPENDED',
    message: 'Only a suspended user can be reactivated.',
  });
}

function lastAdminRequired(): ConflictException {
  return new ConflictException({
    code: 'LAST_ADMIN_REQUIRED',
    message: 'The last active admin cannot be demoted or suspended.',
  });
}

function toAdminUserStatus(value: string): AdminUserStatus {
  if (
    value === 'active' ||
    value === 'suspended' ||
    value === 'deletion_pending'
  ) {
    return value;
  }
  // `anonymized` is excluded by every query in this service; reaching this
  // line means a projection bug, and a 500 fails closed instead of leaking it.
  throw new Error('Unexpected account status in admin user projection.');
}

function projectUser(user: {
  id: number;
  email: string;
  name: string | null;
  role: string;
  status: string;
  lastLoginAt: Date | null;
  createdAt: Date;
}): AdminUserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role === 'admin' ? 'admin' : 'user',
    status: toAdminUserStatus(user.status),
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(
    actor: AdminUserActor,
    query: AdminUsersQueryDto,
  ): Promise<ApiSuccessResponse<AdminUserDto[]>> {
    assertAdminActor(actor);

    const skip = (query.page - 1) * query.limit;
    const [users, total] =
      query.q === undefined
        ? await this.listWithoutSearch(query, skip)
        : await this.listBySearch(query, skip);

    return {
      success: true,
      data: users.map(projectUser),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async changeRole(
    actor: AdminUserActor,
    userId: number,
    role: AdminRole,
    context: AdminUserMutationContext,
  ): Promise<AdminUserDto> {
    assertAdminActor(actor);

    return this.mutate(actor, async (tx) => {
      const target = await this.lockUser(tx, userId);

      if (target.id === actor.id) throw selfActionForbidden();
      if (target.status !== 'active' && target.status !== 'suspended') {
        throw userNotModifiable();
      }

      if (target.role === role) {
        return projectUser(target);
      }

      // Only demoting the last *active* admin breaks the invariant; demoting a
      // suspended admin does not reduce the active-admin count.
      if (
        target.role === 'admin' &&
        target.status === 'active' &&
        role === 'user' &&
        (await this.countActiveAdmins(tx)) <= 1
      ) {
        throw lastAdminRequired();
      }

      const updated = await tx.user.updateMany({
        where: {
          id: userId,
          status: { in: ['active', 'suspended'] },
          deletedAt: null,
        },
        data: { role },
      });
      if (updated.count !== 1) throw userNotModifiable();

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'user.role_changed',
          targetType: 'user',
          targetId: String(userId),
          correlationId: context.correlationId,
          beforeSummary: { role: target.role },
          afterSummary: { role },
        },
      });

      return this.loadUser(tx, userId);
    });
  }

  async suspend(
    actor: AdminUserActor,
    userId: number,
    reason: string,
    context: AdminUserMutationContext,
  ): Promise<AdminUserDto> {
    assertAdminActor(actor);

    return this.mutate(actor, async (tx) => {
      const target = await this.lockUser(tx, userId);

      if (target.id === actor.id) throw selfActionForbidden();
      if (target.status !== 'active') throw userNotActive();

      if (target.role === 'admin' && (await this.countActiveAdmins(tx)) <= 1) {
        throw lastAdminRequired();
      }

      const updated = await tx.user.updateMany({
        where: { id: userId, status: 'active', deletedAt: null },
        data: { status: 'suspended' },
      });
      if (updated.count !== 1) throw userNotActive();

      // TL-63: every session that is not revoked yet dies with the suspension,
      // in the same transaction as the status change.
      await tx.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'user.suspended',
          targetType: 'user',
          targetId: String(userId),
          correlationId: context.correlationId,
          beforeSummary: { status: 'active' },
          afterSummary: { status: 'suspended', reason },
        },
      });

      return this.loadUser(tx, userId);
    });
  }

  async unsuspend(
    actor: AdminUserActor,
    userId: number,
    context: AdminUserMutationContext,
  ): Promise<AdminUserDto> {
    assertAdminActor(actor);

    return this.mutate(actor, async (tx) => {
      const target = await this.lockUser(tx, userId);

      if (target.status !== 'suspended') throw userNotSuspended();

      const updated = await tx.user.updateMany({
        where: { id: userId, status: 'suspended', deletedAt: null },
        data: { status: 'active' },
      });
      if (updated.count !== 1) throw userNotSuspended();

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'user.unsuspended',
          targetType: 'user',
          targetId: String(userId),
          correlationId: context.correlationId,
          beforeSummary: { status: 'suspended' },
          afterSummary: { status: 'active' },
        },
      });

      return this.loadUser(tx, userId);
    });
  }

  private async listWithoutSearch(
    query: AdminUsersQueryDto,
    skip: number,
  ): Promise<[AdminUserRecord[], number]> {
    // TL-61: by default hide anonymized and soft-deleted accounts; an explicit
    // `status=deletion_pending` filter is the only way to list pending rows
    // (their `deletedAt` is already set by the deletion request).
    const where: Prisma.UserWhereInput = query.status
      ? { status: query.status }
      : { deletedAt: null, status: { not: 'anonymized' } };
    if (query.role !== undefined) where.role = query.role;

    return this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: ADMIN_USER_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);
  }

  private async listBySearch(
    query: AdminUsersQueryDto,
    skip: number,
  ): Promise<[AdminUserSearchRow[], number]> {
    const q = query.q;
    if (q === undefined) throw new Error('Search query is missing.');

    const filters: Prisma.Sql[] = [];
    if (query.status !== undefined) {
      filters.push(Prisma.sql`"status" = ${query.status}::"AccountStatus"`);
    } else {
      filters.push(
        Prisma.sql`"deletedAt" IS NULL`,
        Prisma.sql`"status" <> 'anonymized'`,
      );
    }
    if (query.role !== undefined) {
      filters.push(Prisma.sql`"role" = ${query.role}::"Role"`);
    }
    // TL-61: ILIKE over email/name, metacharacters escaped by escapeLike so a
    // user typing `%` searches for a literal percent sign.
    const pattern = `%${escapeLike(q)}%`;
    filters.push(
      Prisma.sql`("email" ILIKE ${pattern} OR "name" ILIKE ${pattern})`,
    );
    const whereSql = Prisma.join(filters, ' AND ');

    const [rows, counts] = await this.prisma.$transaction([
      this.prisma.$queryRaw<AdminUserSearchRow[]>(Prisma.sql`
        SELECT "id", "email", "name", "role", "status", "lastLoginAt", "createdAt"
        FROM "User"
        WHERE ${whereSql}
        ORDER BY "createdAt" DESC, "id" DESC
        LIMIT ${query.limit} OFFSET ${skip}
      `),
      this.prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
        SELECT count(*)::int AS total FROM "User" WHERE ${whereSql}
      `),
    ]);

    return [rows, counts[0]?.total ?? 0];
  }

  /**
   * TL-65: advisory lock first, then a row lock on the target.
   *
   * TL-76: after the advisory lock, re-read the acting admin under
   * `FOR UPDATE` before touching the target. RolesGuard checked the actor at
   * request start; a concurrent demotion or suspension between guard and this
   * transaction must not let the stale request through, so the check fails
   * closed with the same message RolesGuard uses and no write happens.
   */
  private async mutate<T>(
    actor: AdminUserActor,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      // `pg_advisory_xact_lock` returns `void`, which `$queryRaw` cannot
      // deserialize; `$executeRaw` waits for the lock and returns its row count.
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(${ADMIN_USERS_ADVISORY_LOCK_KEY}::bigint)`,
      );

      const actors = await tx.$queryRaw<ActingAdminRow[]>(
        Prisma.sql`
          SELECT "id", "role", "status", "deletedAt"
          FROM "User"
          WHERE "id" = ${actor.id}
          FOR UPDATE
        `,
      );
      const actorRow = actors[0];
      if (
        actorRow === undefined ||
        actorRow.role !== 'admin' ||
        actorRow.status !== 'active' ||
        actorRow.deletedAt !== null
      ) {
        // Same status/message RolesGuard returns; `code` is explicit so the
        // envelope is identical in both rejection paths.
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Insufficient role.',
        });
      }

      return work(tx);
    });
  }

  private async lockUser(
    tx: Prisma.TransactionClient,
    userId: number,
  ): Promise<AdminUserRecord> {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`,
    );

    const target = await tx.user.findUnique({
      where: { id: userId },
      select: ADMIN_USER_SELECT,
    });
    if (target === null || target.status === 'anonymized') throw userNotFound();
    return target;
  }

  private async loadUser(
    tx: Prisma.TransactionClient,
    userId: number,
  ): Promise<AdminUserDto> {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: ADMIN_USER_SELECT,
    });
    return projectUser(user);
  }

  /** TL-62/TL-65: counted inside the advisory-locked transaction. */
  private countActiveAdmins(tx: Prisma.TransactionClient): Promise<number> {
    return tx.user.count({
      where: { role: 'admin', status: 'active', deletedAt: null },
    });
  }
}
