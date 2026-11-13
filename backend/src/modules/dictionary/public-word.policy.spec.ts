import {
  MIN_PUBLIC_LEVEL_ORDER_SQL,
  PUBLIC_WORD_LEVELS,
  PUBLIC_WORD_SQL,
  PUBLIC_WORD_WHERE,
} from './public-word.policy';

describe('public word policy', () => {
  it('states the same four conditions in Prisma and in SQL', () => {
    expect(PUBLIC_WORD_WHERE).toEqual({
      status: 'published',
      deletedAt: null,
      isPure: true,
      meanings: { some: {} },
    });
    expect(PUBLIC_WORD_SQL.values).toEqual([]);
    const conditions = PUBLIC_WORD_SQL.sql.split(' AND ');
    expect(conditions).toEqual([
      `w."status" = 'published'`,
      'w."deletedAt" IS NULL',
      'w."isPure" = true',
      'EXISTS (SELECT 1 FROM "WordMeaning" pm WHERE pm."wordId" = w."id")',
    ]);
  });

  it('counts a Level the way PUBLIC_WORD_LEVELS shows it', () => {
    expect(PUBLIC_WORD_LEVELS.where).toEqual({
      level: { status: 'published', deletedAt: null },
    });
    expect(MIN_PUBLIC_LEVEL_ORDER_SQL.sql).toContain('min(l."orderIndex")');
    expect(MIN_PUBLIC_LEVEL_ORDER_SQL.sql).toContain(
      `l."status" = 'published'`,
    );
    expect(MIN_PUBLIC_LEVEL_ORDER_SQL.sql).toContain('l."deletedAt" IS NULL');
    expect(MIN_PUBLIC_LEVEL_ORDER_SQL.values).toEqual([]);
  });
});
