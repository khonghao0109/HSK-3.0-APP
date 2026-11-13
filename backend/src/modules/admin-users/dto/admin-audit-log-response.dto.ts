export class AdminAuditLogActorDto {
  id!: number;
  name!: string | null;
  email!: string;
}

export class AdminAuditLogTargetDto {
  email!: string;
}

export class AdminAuditRoleChangeDto {
  from!: 'user' | 'admin';
  to!: 'user' | 'admin';
}

/**
 * TL-67: one audit row as the admin console sees it. `reason` exists only for
 * `user.suspended`; `roleChange` is the minimal role transition projection.
 * `ipAddress`, `userAgent` and the raw before/after summaries never leave the
 * server.
 */
export class AdminAuditLogDto {
  /** `AuditLog.id` is a PostgreSQL bigint; JSON exposes it as a string. */
  id!: string;
  createdAt!: Date;
  action!: string;
  actor!: AdminAuditLogActorDto | null;
  targetType!: string;
  targetId!: string | null;
  target!: AdminAuditLogTargetDto | null;
  reason!: string | null;
  roleChange!: AdminAuditRoleChangeDto | null;
}
