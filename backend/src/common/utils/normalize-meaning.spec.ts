import { normalizeMeaning } from './normalize-meaning';

describe('normalizeMeaning', () => {
  it.each([
    ['  Học   Tập ', 'hoc tap'],
    ['Đường', 'duong'],
    ['TO STUDY', 'to study'],
    ['Nguyễn', 'nguyen'],
    ['', ''],
    [' \t\n ', ''],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeMeaning(input)).toBe(expected);
  });
});
