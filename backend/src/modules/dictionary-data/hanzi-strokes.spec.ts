import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseHanziGraphics } from './hanzi-strokes';

const root = join(__dirname, '../../..');
const dir = join(root, 'content/hanzi/makemeahanzi');

describe('Make Me a Hanzi HSK1 subset (Q357)', () => {
  const text = readFileSync(join(dir, 'graphics-hsk1.jsonl'), 'utf8');

  it('matches the checksum recorded in SOURCE.md and keeps the license file', () => {
    const digest = createHash('sha256').update(text).digest('hex');
    expect(readFileSync(join(dir, 'SOURCE.md'), 'utf8')).toContain(digest);
    expect(readFileSync(join(dir, 'ARPHICPL.TXT'), 'utf8')).toContain(
      'ARPHIC PUBLIC LICENSE',
    );
  });

  it('covers every character of the HSK1 vocabulary', () => {
    const rows = parseHanziGraphics(text);
    const words = JSON.parse(
      readFileSync(join(root, 'scripts/dictionary/raw/hsk1.json'), 'utf8'),
    ) as { hanzi: string }[];
    const chars = new Set(
      words.flatMap((word) =>
        [...word.hanzi].filter((c) => /\p{Script=Han}/u.test(c)),
      ),
    );
    expect(new Set(rows.map((row) => row.character))).toEqual(chars);
    const yi = rows.find((row) => row.character === '一');
    expect(yi?.strokes).toHaveLength(1);
    expect(rows.find((row) => row.character === '我')?.strokes).toHaveLength(7);
  });

  it('rejects malformed rows', () => {
    const good = {
      character: '一',
      strokes: ['M 1 2 L 3 4 Z'],
      medians: [
        [
          [1, 2],
          [3, 4],
        ],
      ],
    };
    const line = (row: unknown) => JSON.stringify(row);
    expect(parseHanziGraphics(line(good))).toHaveLength(1);
    expect(() => parseHanziGraphics(`${line(good)}\n${line(good)}`)).toThrow(
      'trùng',
    );
    expect(() =>
      parseHanziGraphics(line({ ...good, character: '一二' })),
    ).toThrow('1 ký tự');
    expect(() => parseHanziGraphics(line({ ...good, medians: [] }))).toThrow(
      'medians',
    );
    expect(() =>
      parseHanziGraphics(line({ ...good, strokes: ['<script>'] })),
    ).toThrow('SVG path');
  });
});
