import { Prisma } from '@prisma/client';

/**
 * TL-65: every admin user mutation starts by taking this transaction-level
 * advisory lock, so the "last active admin" count and the conditional UPDATE
 * cannot interleave. The key is constant: one lock serializes all mutations.
 */
export const ADMIN_USERS_ADVISORY_LOCK_KEY = 5_300_201;

export const ADMIN_USER_STATUSES = [
  'active',
  'suspended',
  'deletion_pending',
] as const;

export type AdminUserStatus = (typeof ADMIN_USER_STATUSES)[number];

export type AdminRole = 'user' | 'admin';

export type AuditRoleChange = { from: AdminRole; to: AdminRole };

function readSummaryString(
  summary: Prisma.JsonValue | null,
  key: string,
): string | null {
  if (
    summary === null ||
    typeof summary !== 'object' ||
    Array.isArray(summary)
  ) {
    return null;
  }
  const value = (summary as Record<string, Prisma.JsonValue>)[key];
  return typeof value === 'string' ? value : null;
}

function toAdminRole(value: string | null): AdminRole | null {
  return value === 'user' || value === 'admin' ? value : null;
}

/**
 * TL-66/TL-67: the suspension reason is the only summary value the API may
 * return, and only for `user.suspended`.
 */
export function auditReason(
  action: string,
  afterSummary: Prisma.JsonValue | null,
): string | null {
  return action === 'user.suspended'
    ? readSummaryString(afterSummary, 'reason')
    : null;
}

/**
 * TL-73 renders the role transition in the audit detail column while TL-67
 * forbids returning raw before/after summaries. This projection exposes only
 * the two role values, never the surrounding summary objects.
 */
export function auditRoleChange(
  action: string,
  beforeSummary: Prisma.JsonValue | null,
  afterSummary: Prisma.JsonValue | null,
): AuditRoleChange | null {
  if (action !== 'user.role_changed') return null;

  const from = toAdminRole(readSummaryString(beforeSummary, 'role'));
  const to = toAdminRole(readSummaryString(afterSummary, 'role'));
  return from !== null && to !== null ? { from, to } : null;
}
