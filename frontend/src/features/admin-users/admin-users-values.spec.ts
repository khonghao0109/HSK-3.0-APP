import { describe, expect, it } from 'vitest';

import {
  adminUserErrorMessage,
  adminUserRoleLabel,
  adminUserStatusLabel,
  adminUserStatusTone,
  auditActionLabel,
  auditRoleTransitionLabel,
} from './admin-users-values';

describe('admin user labels', () => {
  it('labels roles and statuses in Vietnamese', () => {
    expect(adminUserRoleLabel('user')).toBe('Người học');
    expect(adminUserRoleLabel('admin')).toBe('Quản trị viên');
    expect(adminUserStatusLabel('active')).toBe('Hoạt động');
    expect(adminUserStatusLabel('suspended')).toBe('Đã khoá');
    expect(adminUserStatusLabel('deletion_pending')).toBe('Chờ xoá');
    expect(adminUserStatusTone('suspended')).toBe('suspended');
    expect(adminUserStatusTone('deletion_pending')).toBe('pending');
  });

  it('labels known audit actions and falls back to the raw code', () => {
    expect(auditActionLabel('user.role_changed')).toBe('Đổi vai trò');
    expect(auditActionLabel('user.suspended')).toBe('Khoá tài khoản');
    expect(auditActionLabel('user.unsuspended')).toBe('Mở khoá tài khoản');
    expect(auditActionLabel('account.deletion_requested')).toBe(
      'Yêu cầu xoá tài khoản',
    );
    expect(auditActionLabel('account.deletion_cancelled')).toBe(
      'Huỷ yêu cầu xoá',
    );
    expect(auditActionLabel('media.archived')).toBe('media.archived');
  });

  it('renders the role transition detail from roleChange', () => {
    expect(auditRoleTransitionLabel({ from: 'user', to: 'admin' })).toBe(
      'Người học → Quản trị viên',
    );
    expect(auditRoleTransitionLabel(null)).toBeNull();
  });
});

describe('adminUserErrorMessage', () => {
  it('maps every contract error code to a Vietnamese sentence', () => {
    for (const code of [
      'ADMIN_SELF_ACTION_FORBIDDEN',
      'LAST_ADMIN_REQUIRED',
      'USER_NOT_MODIFIABLE',
      'USER_NOT_ACTIVE',
      'USER_NOT_SUSPENDED',
      'USER_NOT_FOUND',
    ]) {
      expect(adminUserErrorMessage(409, code)).not.toMatch(/[a-z]_[a-z]/u);
    }
    expect(adminUserErrorMessage(409, 'ADMIN_SELF_ACTION_FORBIDDEN')).toContain(
      'chính mình',
    );
  });

  it('falls back to status-based sentences for unknown or missing codes', () => {
    expect(adminUserErrorMessage(400, null)).toContain('không hợp lệ');
    expect(adminUserErrorMessage(401, null)).toContain('Phiên đăng nhập');
    expect(adminUserErrorMessage(403, null)).toContain('không có quyền');
    expect(adminUserErrorMessage(404, null)).toContain('Không tìm thấy');
    expect(adminUserErrorMessage(500, 'SOMETHING_NEW')).toContain(
      'Không thực hiện được',
    );
  });
});
