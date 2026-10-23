import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AdminAuditLogsQueryDto } from './admin-audit-logs-query.dto';
import { AdminUsersQueryDto } from './admin-users-query.dto';
import { ChangeUserRoleDto } from './change-user-role.dto';
import { SuspendUserDto } from './suspend-user.dto';

type DtoConstructor<T extends object> = new () => T;

const validateDto = <T extends object>(
  type: DtoConstructor<T>,
  values: Record<string, unknown>,
) =>
  validate(plainToInstance(type, values), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

const errorProperties = async <T extends object>(
  type: DtoConstructor<T>,
  values: Record<string, unknown>,
): Promise<string[]> =>
  (await validateDto(type, values)).map((error) => error.property);

describe('admin users DTOs', () => {
  describe('AdminUsersQueryDto', () => {
    it('trims q and treats an all-whitespace search as absent', () => {
      expect(plainToInstance(AdminUsersQueryDto, { q: '  an  ' }).q).toBe('an');
      expect(
        plainToInstance(AdminUsersQueryDto, { q: '   ' }).q,
      ).toBeUndefined();
    });

    it('rejects the removed teacher role and the internal anonymized status', async () => {
      expect(
        await errorProperties(AdminUsersQueryDto, { role: 'teacher' }),
      ).toContain('role');
      expect(
        await errorProperties(AdminUsersQueryDto, { status: 'anonymized' }),
      ).toContain('status');
    });

    it('accepts every documented filter', async () => {
      expect(
        await validateDto(AdminUsersQueryDto, {
          page: 2,
          limit: 50,
          role: 'admin',
          status: 'deletion_pending',
          q: 'an@example.com',
        }),
      ).toHaveLength(0);
    });

    it('caps q at 100 characters', async () => {
      expect(
        await errorProperties(AdminUsersQueryDto, { q: 'x'.repeat(101) }),
      ).toContain('q');
    });
  });

  describe('ChangeUserRoleDto', () => {
    it('accepts only user and admin', async () => {
      expect(
        await validateDto(ChangeUserRoleDto, { role: 'user' }),
      ).toHaveLength(0);
      expect(
        await validateDto(ChangeUserRoleDto, { role: 'admin' }),
      ).toHaveLength(0);
      expect(
        await errorProperties(ChangeUserRoleDto, { role: 'teacher' }),
      ).toContain('role');
      expect(await errorProperties(ChangeUserRoleDto, {})).toContain('role');
    });
  });

  describe('SuspendUserDto', () => {
    it('trims the stored reason', () => {
      expect(
        plainToInstance(SuspendUserDto, { reason: '  Spam links  ' }).reason,
      ).toBe('Spam links');
    });

    it('rejects an empty, whitespace-only or over-long reason', async () => {
      expect(
        await errorProperties(SuspendUserDto, { reason: '   ' }),
      ).toContain('reason');
      expect(
        await errorProperties(SuspendUserDto, { reason: 'x'.repeat(501) }),
      ).toContain('reason');
      expect(await errorProperties(SuspendUserDto, { reason: 12 })).toContain(
        'reason',
      );
    });

    it('accepts a 500-character reason', async () => {
      expect(
        await validateDto(SuspendUserDto, { reason: 'x'.repeat(500) }),
      ).toHaveLength(0);
    });
  });

  describe('AdminAuditLogsQueryDto', () => {
    it('trims target filters and caps them at 64 characters', async () => {
      expect(
        plainToInstance(AdminAuditLogsQueryDto, {
          targetType: ' user ',
          targetId: ' 42 ',
        }),
      ).toMatchObject({ targetType: 'user', targetId: '42' });

      expect(
        await errorProperties(AdminAuditLogsQueryDto, {
          targetType: 'x'.repeat(65),
        }),
      ).toContain('targetType');
    });
  });
});
