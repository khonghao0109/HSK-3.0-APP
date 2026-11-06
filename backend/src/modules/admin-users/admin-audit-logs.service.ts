import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { POSTGRESQL_INT4_MAX } from '../../common/constants/database.constants';
import { ApiSuccessResponse } from '../../common/interfaces/api-response.interface';
import { PrismaService } from '../../prisma/prisma.service';

import { auditReason, auditRoleChange } from './admin-users.policy';
import type { AdminUserActor } from './admin-users.service';
import { AdminAuditLogDto } from './dto/admin-audit-log-response.dto';
import { AdminAuditLogsQueryDto } from './dto/admin-audit-logs-query.dto';

const AUDIT_LOG_SELECT = {
  id: true,
  createdAt: true,
  action: true,
  targetType: true,
  targetId: true,
  beforeSummary: true,
  afterSummary: true,
  actor: { select: { id: true, name: true, email: true } },
} satisfies Prisma.AuditLogSelect;

type AuditLogRecord = Prisma.AuditLogGetPayload<{
  select: typeof AUDIT_LOG_SELECT;
}>;

// Safety actions store `User` (capitalised) while this task writes `user`.
const USER_TARGET_TYPE = /^user$/i;

function parseTargetUserId(value: string | null): number | null {
  if (value === null || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= POSTGRESQL_INT4_MAX
    ? parsed
    : null;
}

@Injectable()
export class AdminAuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async listAuditLogs(
    actor: AdminUserActor,
    query: AdminAuditLogsQueryDto,
  ): Promise<ApiSuccessResponse<AdminAuditLogDto[]>> {
    if (actor.role !== 'admin') {
      throw new ForbiddenException('Insufficient role.');
    }

    const where: Prisma.AuditLogWhereInput = {};
    if (query.targetType !== undefined) where.targetType = query.targetType;
    if (query.targetId !== undefined) where.targetId = query.targetId;

    const skip = (query.page - 1) * query.limit;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        select: AUDIT_LOG_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: query.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const targetEmails = await this.resolveTargetEmails(rows);

    return {
      success: true,
      data: rows.map((row) => this.project(row, targetEmails)),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  /** One batched lookup; anonymized users contribute no target email. */
  private async resolveTargetEmails(
    rows: AuditLogRecord[],
  ): Promise<Map<number, string>> {
    const userIds = new Set<number>();
    for (const row of rows) {
      if (!USER_TARGET_TYPE.test(row.targetType)) continue;
      const userId = parseTargetUserId(row.targetId);
      if (userId !== null) userIds.add(userId);
    }
    if (userIds.size === 0) return new Map();

    const users = await this.prisma.user.findMany({
      where: { id: { in: [...userIds] }, status: { not: 'anonymized' } },
      select: { id: true, email: true },
    });
    return new Map(users.map((user) => [user.id, user.email]));
  }

  private project(
    row: AuditLogRecord,
    targetEmails: Map<number, string>,
  ): AdminAuditLogDto {
    const targetUserId = USER_TARGET_TYPE.test(row.targetType)
      ? parseTargetUserId(row.targetId)
      : null;
    const targetEmail =
      targetUserId === null ? undefined : targetEmails.get(targetUserId);

    return {
      id: row.id.toString(),
      createdAt: row.createdAt,
      action: row.action,
      actor: row.actor === null ? null : row.actor,
      targetType: row.targetType,
      targetId: row.targetId,
      target: targetEmail === undefined ? null : { email: targetEmail },
      reason: auditReason(row.action, row.afterSummary),
      roleChange: auditRoleChange(
        row.action,
        row.beforeSummary,
        row.afterSummary,
      ),
    };
  }
}
