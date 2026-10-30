import { z } from 'zod';

import { backendEnvelope, backendPage } from '@/lib/api/backend-envelope';

import type { AdminAuditRow, AdminUserRow } from './admin-users-values';

const adminUserSchema = z.object({
  id: z.number().int().positive(),
  email: z.string(),
  name: z.string().nullable(),
  role: z.enum(['user', 'admin']),
  status: z.enum(['active', 'suspended', 'deletion_pending']),
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

const auditActorSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().nullable(),
  email: z.string(),
});

const auditLogSchema = z.object({
  id: z.string().regex(/^\d+$/u),
  createdAt: z.string().datetime(),
  action: z.string(),
  actor: auditActorSchema.nullable(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  target: z.object({ email: z.string() }).nullable(),
  reason: z.string().nullable(),
  roleChange: z
    .object({ from: z.enum(['user', 'admin']), to: z.enum(['user', 'admin']) })
    .nullable(),
});

export type AdminUsersListPage = {
  data: AdminUserRow[];
  meta: { page: number; limit: number; total: number; totalPages: number };
};

export type AdminAuditListPage = {
  data: AdminAuditRow[];
  meta: { page: number; limit: number; total: number; totalPages: number };
};

export const backendAdminUsersPageSchema = backendPage(adminUserSchema);
export const backendAdminAuditPageSchema = backendPage(auditLogSchema);

/** PATCH role / POST suspend / POST unsuspend trả đúng một `AdminUser`. */
export const backendAdminUserMutationSchema = backendEnvelope(adminUserSchema);
