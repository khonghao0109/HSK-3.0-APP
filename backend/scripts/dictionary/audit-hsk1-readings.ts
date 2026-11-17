import * as fs from 'fs';
import * as path from 'path';
import {
  auditReadings,
  readingsFromGfCsv,
  renderMigrationSql,
} from '../../src/modules/dictionary-data/gf0025-reading-audit';

/**
 * P4/P5: so `parsed/final_words.json` (nguồn seed `Word`/`WordLevel`) cấp HSK1 với GF0025-2021.
 *   npx ts-node scripts/dictionary/audit-hsk1-readings.ts            # chỉ in kết quả
 *   npx ts-node scripts/dictionary/audit-hsk1-readings.ts --write <migration.sql>
 * `--write` sửa `final_words.json` (pinyin_tone, bỏ level HSK1 của cách đọc thừa) và ghi SQL migration.
 * shortcut: chạy lại `build-final.ts` sẽ ghi đè bản sửa này; nếu cần build lại, chạy tiếp script này.
 */
type FinalWord = {
  hanzi: string;
  pinyin: string;
  pinyin_tone?: string | null;
  level: string | null;
};

const dir = __dirname;
const finalPath = path.join(dir, 'parsed/final_words.json');
const gf = readingsFromGfCsv(
  fs.readFileSync(path.join(dir, 'raw/gf0025-hsk1.csv'), 'utf-8'),
);
const finalWords = JSON.parse(
  fs.readFileSync(finalPath, 'utf-8'),
) as FinalWord[];
const hsk1 = finalWords
  .filter((w) => w.level === 'HSK1')
  .map((w) => ({
    hanzi: w.hanzi,
    pinyin: w.pinyin,
    pinyinTone: w.pinyin_tone ?? null,
  }));
const audit = auditReadings(gf, hsk1);

console.log(
  JSON.stringify(
    {
      hsk1Rows: hsk1.length,
      gfReadings: gf.length,
      ok: audit.ok,
      corrections: audit.corrections.map(
        (c) => `${c.gfId} ${c.hanzi} ${c.from} -> ${c.to}`,
      ),
      spurious: audit.spurious.map((s) => `${s.hanzi} ${s.pinyinTone}`),
      missing: audit.missing.map((m) => `${m.id} ${m.hanzi} ${m.pinyin}`),
      ambiguous: audit.ambiguous.map(
        (a) => `${a.hanzi} ${a.pinyinTone} [${a.candidates.join('|')}]`,
      ),
    },
    null,
    2,
  ),
);

const writeIndex = process.argv.indexOf('--write');
if (writeIndex !== -1) {
  const sqlPath = process.argv[writeIndex + 1];
  if (!sqlPath) throw new Error('--write cần đường dẫn file migration');
  const fix = new Map(
    audit.corrections.map((c) => [`${c.hanzi}\u0000${c.pinyin}`, c.to]),
  );
  const drop = new Set(
    audit.spurious.map((s) => `${s.hanzi}\u0000${s.pinyin}`),
  );
  for (const w of finalWords) {
    if (w.level !== 'HSK1') continue;
    const k = `${w.hanzi}\u0000${w.pinyin}`;
    if (fix.has(k)) w.pinyin_tone = fix.get(k);
    if (drop.has(k)) w.level = null;
  }
  fs.writeFileSync(finalPath, JSON.stringify(finalWords, null, 2), 'utf-8');
  fs.writeFileSync(sqlPath, renderMigrationSql(audit), 'utf-8');
}
