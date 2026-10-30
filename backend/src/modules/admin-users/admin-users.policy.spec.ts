import {
  ADMIN_USER_STATUSES,
  auditReason,
  auditRoleChange,
} from './admin-users.policy';

describe('admin users policy', () => {
  describe('ADMIN_USER_STATUSES', () => {
    it('lists exactly the three filterable statuses', () => {
      expect(ADMIN_USER_STATUSES).toEqual([
        'active',
        'suspended',
        'deletion_pending',
      ]);
      expect(ADMIN_USER_STATUSES).not.toContain('anonymized');
    });
  });

  describe('auditReason', () => {
    it('returns the reason only for user.suspended', () => {
      expect(
        auditReason('user.suspended', { status: 'suspended', reason: 'Spam' }),
      ).toBe('Spam');
      expect(auditReason('user.role_changed', { role: 'admin' })).toBeNull();
      expect(auditReason('user.unsuspended', { reason: 'leak' })).toBeNull();
    });

    it('ignores missing, non-string and malformed summaries', () => {
      expect(auditReason('user.suspended', null)).toBeNull();
      expect(auditReason('user.suspended', { reason: 42 })).toBeNull();
      expect(auditReason('user.suspended', ['Spam'])).toBeNull();
      expect(auditReason('user.suspended', 'Spam')).toBeNull();
    });
  });

  describe('auditRoleChange', () => {
    it('projects the role transition for user.role_changed', () => {
      expect(
        auditRoleChange(
          'user.role_changed',
          { role: 'user' },
          { role: 'admin' },
        ),
      ).toEqual({ from: 'user', to: 'admin' });
    });

    it('never projects values outside the two known roles', () => {
      expect(
        auditRoleChange(
          'user.role_changed',
          { role: 'teacher' },
          { role: 'admin' },
        ),
      ).toBeNull();
      expect(
        auditRoleChange('user.role_changed', { role: 'admin' }, { role: 7 }),
      ).toBeNull();
    });

    it('returns null for other actions and incomplete summaries', () => {
      expect(
        auditRoleChange('user.suspended', { role: 'user' }, { role: 'admin' }),
      ).toBeNull();
      expect(
        auditRoleChange('user.role_changed', null, { role: 'admin' }),
      ).toBeNull();
      expect(
        auditRoleChange('user.role_changed', { role: null }, { role: 'admin' }),
      ).toBeNull();
    });
  });
});
