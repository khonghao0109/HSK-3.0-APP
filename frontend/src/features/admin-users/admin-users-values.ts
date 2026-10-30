/**
 * Giá trị và nhãn thuần của trang quản lý người dùng (M5.3) — KHÔNG import
 * Zod để client component dùng được mà không kéo Zod vào bundle
 * (frontend/AGENTS.md, client-bundle-guard.spec.ts). Hình dạng dữ liệu ở đây
 * khớp `admin-users-contract.ts` (server-only) nhưng viết tay để client dùng.
 */

export const ADMIN_USER_TABS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'learner', label: 'Người học' },
  { key: 'admin', label: 'Quản trị viên' },
] as const;

export type AdminUserTab = (typeof ADMIN_USER_TABS)[number]['key'];

export const ADMIN_USER_STATUSES = [
  'active',
  'suspended',
  'deletion_pending',
] as const;

export type AdminUserStatus = (typeof ADMIN_USER_STATUSES)[number];

export const ADMIN_USERS_PAGE_LIMIT = 20;
export const ADMIN_AUDIT_PAGE_LIMIT = 20;
export const SUSPEND_REASON_MAX_LENGTH = 500;

export type AdminUserRow = {
  id: number;
  email: string;
  name: string | null;
  role: 'user' | 'admin';
  status: AdminUserStatus;
  lastLoginAt: string | null;
  createdAt: string;
};

export type AdminAuditRow = {
  id: string;
  createdAt: string;
  action: string;
  actor: { id: number; name: string | null; email: string } | null;
  targetType: string;
  targetId: string | null;
  target: { email: string } | null;
  reason: string | null;
  roleChange: { from: 'user' | 'admin'; to: 'user' | 'admin' } | null;
};

export function adminUserRoleLabel(role: string): string {
  if (role === 'admin') return 'Quản trị viên';
  if (role === 'user') return 'Người học';
  return role;
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Hoạt động',
  suspended: 'Đã khoá',
  deletion_pending: 'Chờ xoá',
};

export function adminUserStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

/** Lớp màu trạng thái (kèm chữ, không chỉ màu — TL-71). */
export function adminUserStatusTone(
  status: string,
): 'active' | 'suspended' | 'pending' {
  if (status === 'active') return 'active';
  if (status === 'suspended') return 'suspended';
  return 'pending';
}

const AUDIT_ACTION_LABEL: Record<string, string> = {
  'user.role_changed': 'Đổi vai trò',
  'user.suspended': 'Khoá tài khoản',
  'user.unsuspended': 'Mở khoá tài khoản',
  'account.deletion_requested': 'Yêu cầu xoá tài khoản',
  'account.deletion_cancelled': 'Huỷ yêu cầu xoá',
};

/** TL-73: hành động đã biết hiện nhãn Việt, mã khác hiện nguyên mã. */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABEL[action] ?? action;
}

export function auditRoleTransitionLabel(
  roleChange: { from: string; to: string } | null,
): string | null {
  if (!roleChange) return null;
  return `${adminUserRoleLabel(roleChange.from)} → ${adminUserRoleLabel(roleChange.to)}`;
}

/** TL-72: mọi mã lỗi có nhãn tiếng Việt trong vùng live. */
const ERROR_MESSAGE: Record<string, string> = {
  ADMIN_SELF_ACTION_FORBIDDEN:
    'Bạn không thể thao tác trên tài khoản của chính mình.',
  LAST_ADMIN_REQUIRED:
    'Không thể hạ quyền hoặc khoá quản trị viên đang hoạt động cuối cùng.',
  USER_NOT_MODIFIABLE:
    'Chỉ có thể đổi vai trò người dùng đang hoạt động hoặc đã khoá.',
  USER_NOT_ACTIVE: 'Chỉ có thể khoá tài khoản đang hoạt động.',
  USER_NOT_SUSPENDED: 'Chỉ có thể mở khoá tài khoản đang bị khoá.',
  USER_NOT_FOUND: 'Không tìm thấy người dùng. Tải lại trang rồi thử lại.',
};

export function adminUserErrorMessage(
  status: number,
  code?: string | null,
): string {
  if (code && ERROR_MESSAGE[code]) return ERROR_MESSAGE[code];
  if (status === 400) return 'Yêu cầu không hợp lệ. Kiểm tra lại dữ liệu.';
  if (status === 401)
    return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  if (status === 403) return 'Bạn không có quyền thực hiện thao tác này.';
  if (status === 404)
    return 'Không tìm thấy người dùng. Tải lại trang rồi thử lại.';
  if (status === 409)
    return 'Thao tác xung đột với dữ liệu hiện tại. Tải lại trang rồi thử lại.';
  return 'Không thực hiện được thao tác. Thử lại sau.';
}
