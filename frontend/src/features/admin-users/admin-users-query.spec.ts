import { describe, expect, it } from 'vitest';

import {
  adminUsersHref,
  adminUsersTabHref,
  parseAdminUsersQuery,
  serializeAuditSearch,
  serializeUsersSearch,
} from './admin-users-query';

describe('parseAdminUsersQuery', () => {
  it('uses safe defaults for missing or invalid input', () => {
    expect(parseAdminUsersQuery({})).toEqual({
      tab: 'all',
      page: 1,
      auditPage: 1,
    });
    expect(
      parseAdminUsersQuery({
        tab: 'teacher',
        status: 'anonymized',
        q: '   ',
        page: '0',
        auditPage: 'abc',
      }),
    ).toEqual({ tab: 'all', page: 1, auditPage: 1 });
  });

  it('keeps the three supported tabs and caps q at 100 characters', () => {
    expect(parseAdminUsersQuery({ tab: 'learner' }).tab).toBe('learner');
    expect(parseAdminUsersQuery({ tab: 'admin' }).tab).toBe('admin');
    expect(parseAdminUsersQuery({ q: '  an  ' }).q).toBe('an');
    expect(parseAdminUsersQuery({ q: 'x'.repeat(101) }).q).toBeUndefined();
  });

  it('accepts the documented status filter and pagination values', () => {
    expect(
      parseAdminUsersQuery({
        status: 'deletion_pending',
        page: '3',
        auditPage: '2',
      }),
    ).toEqual({
      tab: 'all',
      status: 'deletion_pending',
      page: 3,
      auditPage: 2,
    });
  });
});

describe('serializeUsersSearch', () => {
  it('maps tabs to the backend role filter and keeps other filters', () => {
    const query = parseAdminUsersQuery({
      tab: 'admin',
      status: 'active',
      q: 'an',
      page: '2',
    });
    const params = serializeUsersSearch(query);
    expect(params.get('role')).toBe('admin');
    expect(params.get('status')).toBe('active');
    expect(params.get('q')).toBe('an');
    expect(params.get('page')).toBe('2');
    expect(params.get('limit')).toBe('20');
  });

  it('sends no role filter for the all tab', () => {
    const params = serializeUsersSearch(parseAdminUsersQuery({}));
    expect(params.get('role')).toBeNull();
    expect(
      serializeAuditSearch(parseAdminUsersQuery({ auditPage: '2' })).get(
        'page',
      ),
    ).toBe('2');
  });
});

describe('href builders', () => {
  it('preserves filters when changing one parameter', () => {
    const query = parseAdminUsersQuery({
      tab: 'learner',
      status: 'suspended',
      q: 'minh',
      auditPage: '2',
    });
    expect(adminUsersHref(query, { page: 2 })).toBe(
      '/admin/users?tab=learner&status=suspended&q=minh&page=2&auditPage=2',
    );
    expect(adminUsersTabHref(query, 'admin')).toBe(
      '/admin/users?tab=admin&status=suspended&q=minh&auditPage=2',
    );
  });

  it('falls back to the bare path when nothing is set', () => {
    expect(adminUsersHref(parseAdminUsersQuery({}), {})).toBe('/admin/users');
  });
});
