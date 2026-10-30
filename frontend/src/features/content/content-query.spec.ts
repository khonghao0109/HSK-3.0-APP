import { describe, expect, it } from 'vitest';

import {
  parseContentQuery,
  serializeContentQuery,
  withContentPage,
} from './content-query';

describe('content URL query contract', () => {
  it('falls back to defaults when the query is missing or broken', () => {
    expect(parseContentQuery({})).toEqual({ page: 1, limit: 20 });
    expect(
      parseContentQuery({ page: 'abc', limit: 'xyz', status: 'sai' }),
    ).toEqual({ page: 1, limit: 20 });
    expect(parseContentQuery({ page: '-1', limit: '0' })).toEqual({
      page: 1,
      limit: 20,
    });
  });

  it('clamps limit to the backend ceiling of 100', () => {
    expect(parseContentQuery({ limit: '9999' })).toMatchObject({ limit: 20 });
    expect(parseContentQuery({ limit: '100' })).toMatchObject({ limit: 100 });
  });

  it('keeps only supported filters', () => {
    expect(
      parseContentQuery({
        page: '2',
        limit: '50',
        levelId: '3',
        status: 'published',
        search: '  bài 12  ',
        ignored: 'secret',
      }),
    ).toEqual({
      page: 2,
      limit: 50,
      levelId: 3,
      status: 'published',
      search: 'bài 12',
    });
  });

  it('rejects a non-numeric levelId and an unknown status', () => {
    const query = parseContentQuery({ levelId: 'abc', status: 'archivedd' });
    expect(query.levelId).toBeUndefined();
    expect(query.status).toBeUndefined();
  });

  it('trims search and cuts it at 200 characters', () => {
    expect(parseContentQuery({ search: '   ' })).toEqual({
      page: 1,
      limit: 20,
    });
    const long = `  ${'a'.repeat(250)}  `;
    expect(parseContentQuery({ search: long }).search).toHaveLength(200);
  });

  it('serializes only allowlisted non-empty filters', () => {
    expect(
      serializeContentQuery({
        page: 2,
        limit: 20,
        levelId: 3,
        status: 'draft',
        search: 'du lịch',
      }).toString(),
    ).toBe('page=2&limit=20&levelId=3&status=draft&search=du+l%E1%BB%8Bch');
  });

  it('round-trips through parse and keeps filters when pagination changes', () => {
    const query = parseContentQuery({
      page: '2',
      levelId: '3',
      status: 'draft',
      search: 'bài',
    });
    expect(
      parseContentQuery(Object.fromEntries(serializeContentQuery(query))),
    ).toEqual(query);
    const pageUrl = withContentPage(query, 5);
    expect(pageUrl).toContain('page=5');
    expect(pageUrl).toContain('status=draft');
    expect(pageUrl).toContain('levelId=3');
    expect(withContentPage(query, 0)).toContain('page=1');
  });
});
