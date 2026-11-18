import { escapeLike, escapeRegex } from './sql-pattern';

describe('escapeLike', () => {
  it('escapes %, _ and backslash', () => {
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
  });

  it('leaves plain text alone', () => {
    expect(escapeLike('xue xi')).toBe('xue xi');
  });
});

describe('escapeRegex', () => {
  it('escapes every regex metacharacter', () => {
    expect(escapeRegex('\\.^$|?*+()[]{}')).toBe(
      '\\\\\\.\\^\\$\\|\\?\\*\\+\\(\\)\\[\\]\\{\\}',
    );
  });

  it('keeps spaces and letters', () => {
    expect(escapeRegex('to be')).toBe('to be');
  });

  it('matches the escaped text literally', () => {
    const raw = 'a.b (c)';
    expect(new RegExp(escapeRegex(raw)).test('xa.b (c)')).toBe(true);
    expect(new RegExp(escapeRegex(raw)).test('axb c')).toBe(false);
  });
});
