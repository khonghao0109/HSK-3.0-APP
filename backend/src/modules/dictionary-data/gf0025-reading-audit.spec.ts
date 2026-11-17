import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  auditReadings,
  compactPinyin,
  expandGfRow,
  parseCsv,
  readingsFromGfCsv,
  renderMigrationSql,
  toNumberedTones,
} from './gf0025-reading-audit';

const root = join(__dirname, '../../..');
const dictionaryDir = join(root, 'scripts/dictionary');
const migrationPath = join(
  root,
  'prisma/migrations/20261117120000_hsk1_reading_fix_gf0025/migration.sql',
);

type FinalWord = {
  hanzi: string;
  pinyin: string;
  pinyin_tone?: string | null;
  level: string | null;
};

describe('gf0025 reading audit', () => {
  it('converts marked pinyin to numbered tones using the Word syllables', () => {
    expect(toNumberedTones('gè', 'ge')).toBe('ge4');
    expect(toNumberedTones('ma', 'ma')).toBe('ma5');
    expect(toNumberedTones('xiǎopéngyǒu', 'xiao peng you')).toBe(
      'xiao3 peng2 you3',
    );
    expect(toNumberedTones('nǚ’ér', 'nu: er')).toBe('nu:3 er2');
    expect(toNumberedTones('yíxiàr', 'yi xia r')).toBe('yi2 xia4 r5');
    expect(toNumberedTones('chē shang', 'che shang')).toBe('che1 shang5');
    expect(toNumberedTones('gè', 'ga')).toBeNull();
  });

  it('compacts pinyin for matching (ü → u:, no spaces or apostrophes)', () => {
    expect(compactPinyin('nǚ’ér')).toBe('nu:er');
    expect(compactPinyin('xiao3 peng2 you3')).toBe('xiaopengyou');
  });

  it('expands variants and drops example-only entries', () => {
    const variants = JSON.stringify([
      { Simplified: '子', Pinyin: 'zi' },
      { Simplified: '桌子', Pinyin: 'zhuōzi', Example: '1' },
    ]);
    expect(
      expandGfRow({
        id: 'L1-1',
        simplified: '子（桌子）',
        pinyin: 'zi',
        variants,
      }),
    ).toEqual([{ id: 'L1-1', hanzi: '子', pinyin: 'zi' }]);
    expect(parseCsv('a,"b ""c"", d"\n1,2\n')).toEqual([
      ['a', 'b "c", d'],
      ['1', '2'],
    ]);
  });

  it('classifies corrections, spurious readings, missing and ambiguous entries', () => {
    const audit = auditReadings(
      [
        { id: 'L1-1', hanzi: '个', pinyin: 'gè' },
        { id: 'L1-2', hanzi: '六', pinyin: 'liù' },
        { id: 'L1-3', hanzi: '干', pinyin: 'gān' },
        { id: 'L1-4', hanzi: '干', pinyin: 'gàn' },
        { id: 'L1-5', hanzi: '车上', pinyin: 'chē shang' },
      ],
      [
        { hanzi: '个', pinyin: 'ge', pinyinTone: 'ge3' },
        { hanzi: '六', pinyin: 'liu', pinyinTone: 'liu4' },
        { hanzi: '六', pinyin: 'lu', pinyinTone: 'lu4' },
        { hanzi: '干', pinyin: 'gan', pinyinTone: 'gan3' },
      ],
    );
    expect(audit.corrections).toEqual([
      { hanzi: '个', pinyin: 'ge', from: 'ge3', to: 'ge4', gfId: 'L1-1' },
    ]);
    expect(audit.spurious).toEqual([
      { hanzi: '六', pinyin: 'lu', pinyinTone: 'lu4' },
    ]);
    expect(audit.missing.map((m) => m.hanzi)).toEqual(['车上']);
    expect(audit.ambiguous).toEqual([
      {
        hanzi: '干',
        pinyin: 'gan',
        pinyinTone: 'gan3',
        candidates: ['gan1', 'gan4'],
      },
    ]);
    expect(audit.ok).toBe(1);
  });

  it('renders guarded SQL keyed by (hanzi, pinyin) and escapes quotes', () => {
    const sql = renderMigrationSql({
      corrections: [
        { hanzi: "x'", pinyin: 'ge', from: 'ge3', to: 'ge4', gfId: 'L1-1' },
      ],
      spurious: [{ hanzi: '六', pinyin: 'lu', pinyinTone: 'lu4' }],
      missing: [],
      ambiguous: [],
      ok: 0,
    });
    expect(sql).toContain(
      `UPDATE "Word" SET "pinyinTone" = 'ge4', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = 'x''' AND "pinyin" = 'ge' AND "pinyinTone" = 'ge3';`,
    );
    expect(sql).toContain(
      `l."code" = 'HSK1' AND w."hanzi" = '六' AND w."pinyin" = 'lu';`,
    );
    expect(sql).not.toMatch(/DELETE FROM "Word"\b/);
  });

  describe('committed data', () => {
    const gf = readingsFromGfCsv(
      readFileSync(join(dictionaryDir, 'raw/gf0025-hsk1.csv'), 'utf-8'),
    );
    const finalWords = JSON.parse(
      readFileSync(join(dictionaryDir, 'parsed/final_words.json'), 'utf-8'),
    ) as FinalWord[];
    const byKey = new Map(
      finalWords.map((w) => [`${w.hanzi}\u0000${w.pinyin}`, w]),
    );

    it('HSK1 in final_words.json matches GF0025-2021: 498 readings, no correction left', () => {
      const hsk1 = finalWords
        .filter((w) => w.level === 'HSK1')
        .map((w) => ({
          hanzi: w.hanzi,
          pinyin: w.pinyin,
          pinyinTone: w.pinyin_tone ?? null,
        }));
      const audit = auditReadings(gf, hsk1);
      expect(hsk1).toHaveLength(498);
      expect(audit.corrections).toEqual([]);
      expect(audit.spurious).toEqual([]);
      expect(audit.ambiguous).toEqual([]);
      expect(audit.ok).toBe(498);
    });

    it('migration agrees with final_words.json: 36 tone fixes, 32 HSK1 links removed', () => {
      const sql = readFileSync(migrationPath, 'utf-8');
      const updates = [
        ...sql.matchAll(
          /SET "pinyinTone" = '([^']+)'.*?"hanzi" = '([^']+)' AND "pinyin" = '([^']+)' AND "pinyinTone" = '([^']+)';/g,
        ),
      ];
      const deletes = [
        ...sql.matchAll(/w\."hanzi" = '([^']+)' AND w\."pinyin" = '([^']+)';/g),
      ];
      expect(updates).toHaveLength(36);
      expect(deletes).toHaveLength(32);
      for (const [, to, hanzi, pinyin, from] of updates) {
        expect(from).not.toBe(to);
        expect(byKey.get(`${hanzi}\u0000${pinyin}`)?.pinyin_tone).toBe(to);
      }
      for (const [, hanzi, pinyin] of deletes) {
        expect(byKey.get(`${hanzi}\u0000${pinyin}`)?.level).toBeNull();
      }
      expect(sql).not.toMatch(/DELETE FROM "Word"\b/);
    });
  });
});
