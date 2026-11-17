import { normalizePinyin } from '../../common/utils/normalize-pinyin';

/**
 * P4/P5 (PO 17/11/2026): so cách đọc HSK1 trong `Word` với danh sách chuẩn GF0025-2021.
 *
 * `Word` giữ một dòng cho mỗi `(hanzi, pinyin bỏ dấu)`; `pinyinTone` dạng số
 * (`ge4`, neutral = 5) lấy từ dòng CC-CEDICT đầu tiên nên có thể sai thanh, và
 * pipeline gắn cấp theo chữ Hán nên kéo theo cách đọc không thuộc HSK1.
 * Module thuần (không DB, không fs) để script và migration dùng chung, có test.
 */

export type Gf0025Reading = { id: string; hanzi: string; pinyin: string };
export type DbWordReading = {
  hanzi: string;
  pinyin: string;
  pinyinTone: string | null;
};

export type ReadingAudit = {
  corrections: {
    hanzi: string;
    pinyin: string;
    from: string | null;
    to: string;
    gfId: string;
  }[];
  /** Dòng HSK1 không khớp mục GF0025 nào theo (hanzi, pinyin bỏ dấu). */
  spurious: DbWordReading[];
  /** Mục GF0025 không có dòng `Word` HSK1 tương ứng. */
  missing: Gf0025Reading[];
  /** Nhiều mục GF0025 cùng (hanzi, pinyin bỏ dấu) khác thanh; dòng `Word` giữ nguyên. */
  ambiguous: {
    hanzi: string;
    pinyin: string;
    pinyinTone: string | null;
    candidates: string[];
  }[];
  ok: number;
};

const TONE_MARKS: Record<string, number> = { '̄': 1, '́': 2, '̌': 3, '̀': 4 };

/** Khoá so sánh: pinyin bỏ dấu, liền, chữ thường (`ü` → `u:`). */
export function compactPinyin(value: string): string {
  return normalizePinyin(value).replace(/[\s'’\-·]/g, '');
}

/** Một dòng CSV (đã tách cột) → các cách đọc; dòng có `Variants` lấy biến thể, bỏ ví dụ minh hoạ. */
export function expandGfRow(row: {
  id: string;
  simplified: string;
  pinyin: string;
  variants: string;
}): Gf0025Reading[] {
  if (row.variants.trim() === '') {
    return [{ id: row.id, hanzi: row.simplified, pinyin: row.pinyin }];
  }
  const parsed = JSON.parse(row.variants) as {
    Simplified: string;
    Pinyin: string;
    Example?: string;
  }[];
  return parsed
    .filter((variant) => variant.Example === undefined)
    .map((variant) => ({
      id: row.id,
      hanzi: variant.Simplified,
      pinyin: variant.Pinyin,
    }));
}

/**
 * Chuyển pinyin có dấu (`xiǎopéngyǒu`) sang dạng số theo cách tách âm tiết của
 * dòng `Word` (`xiao peng you` → `xiao3 peng2 you3`). Trả `null` khi không khớp chữ.
 */
export function toNumberedTones(
  marked: string,
  dbPinyin: string,
): string | null {
  const letters: string[] = [];
  const tones: number[] = [];
  for (const char of marked.toLowerCase().normalize('NFD')) {
    if (char in TONE_MARKS) {
      if (letters.length === 0) return null;
      tones[letters.length - 1] = TONE_MARKS[char];
    } else if (char === '̈') {
      letters.push(':');
    } else if (/[a-z]/.test(char)) {
      letters.push(char);
    } else if (!/[\s'’\-·]/.test(char)) {
      return null;
    }
  }
  const syllables = normalizePinyin(dbPinyin).split(' ');
  if (syllables.join('') !== letters.join('')) return null;
  let cursor = 0;
  return syllables
    .map((syllable) => {
      const end = cursor + syllable.length;
      const tone =
        tones.slice(cursor, end).find((value) => value !== undefined) ?? 5;
      cursor = end;
      return `${syllable}${tone}`;
    })
    .join(' ');
}

export function auditReadings(
  gf: Gf0025Reading[],
  db: DbWordReading[],
): ReadingAudit {
  const audit: ReadingAudit = {
    corrections: [],
    spurious: [],
    missing: [],
    ambiguous: [],
    ok: 0,
  };
  const key = (hanzi: string, pinyin: string) =>
    `${hanzi}\u0000${compactPinyin(pinyin)}`;
  const gfByKey = new Map<string, Gf0025Reading[]>();
  for (const reading of gf) {
    const k = key(reading.hanzi, reading.pinyin);
    gfByKey.set(k, [...(gfByKey.get(k) ?? []), reading]);
  }
  const dbKeys = new Set(db.map((row) => key(row.hanzi, row.pinyin)));
  for (const row of db) {
    const candidates = gfByKey.get(key(row.hanzi, row.pinyin));
    if (candidates === undefined) {
      audit.spurious.push(row);
      continue;
    }
    const numbered = candidates.map((c) => ({
      c,
      tone: toNumberedTones(c.pinyin, row.pinyin),
    }));
    if (numbered.some((n) => n.tone === null)) {
      throw new Error(`Không tách được âm tiết: ${row.hanzi} ${row.pinyin}`);
    }
    const distinct = [...new Set(numbered.map((n) => n.tone as string))];
    if (row.pinyinTone !== null && distinct.includes(row.pinyinTone)) {
      audit.ok += 1;
    } else if (distinct.length === 1) {
      audit.corrections.push({
        hanzi: row.hanzi,
        pinyin: row.pinyin,
        from: row.pinyinTone,
        to: distinct[0],
        gfId: numbered[0].c.id,
      });
    } else {
      audit.ambiguous.push({ ...row, candidates: distinct });
    }
  }
  const seenMissing = new Set<string>();
  for (const reading of gf) {
    const k = key(reading.hanzi, reading.pinyin);
    if (!dbKeys.has(k) && !seenMissing.has(k)) {
      seenMissing.add(k);
      audit.missing.push(reading);
    }
  }
  return audit;
}

const sqlText = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** SQL tường minh cũ → mới; khoá theo (hanzi, pinyin) vì id khác nhau giữa môi trường. */
export function renderMigrationSql(audit: ReadingAudit): string {
  const lines: string[] = [
    '-- P4/P5 (PO 17/11/2026): sửa dấu thanh HSK1 theo GF0025-2021 và gỡ cấp HSK1 của cách đọc không thuộc HSK1.',
    '-- Sinh bởi scripts/dictionary/audit-hsk1-readings.ts; mỗi UPDATE chỉ đổi khi giá trị cũ khớp. Không xoá dòng Word.',
    '',
  ];
  for (const c of audit.corrections) {
    lines.push(
      `-- ${c.gfId} ${c.hanzi}: ${c.from ?? 'NULL'} -> ${c.to}`,
      `UPDATE "Word" SET "pinyinTone" = ${sqlText(c.to)}, "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = ${sqlText(c.hanzi)} AND "pinyin" = ${sqlText(c.pinyin)} AND "pinyinTone" ${c.from === null ? 'IS NULL' : `= ${sqlText(c.from)}`};`,
    );
  }
  lines.push('');
  for (const s of audit.spurious) {
    lines.push(
      `-- gỡ HSK1: ${s.hanzi} ${s.pinyinTone ?? s.pinyin}`,
      `DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = ${sqlText(s.hanzi)} AND w."pinyin" = ${sqlText(s.pinyin)};`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/** CSV RFC 4180 tối giản (dấu phẩy, ngoặc kép, `""` thoát), đủ cho `raw/gf0025-hsk1.csv`. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (quoted) throw new Error('CSV: ngoặc kép chưa đóng');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Đọc `raw/gf0025-hsk1.csv` (cột ID,Simplified,Pinyin,POS,Variants) thành các cách đọc. */
export function readingsFromGfCsv(text: string): Gf0025Reading[] {
  const [header, ...rows] = parseCsv(text);
  if (header.join(',') !== 'ID,Simplified,Pinyin,POS,Variants') {
    throw new Error(`Header CSV không đúng: ${header.join(',')}`);
  }
  return rows.flatMap(([id, simplified, pinyin, , variants]) =>
    expandGfRow({ id, simplified, pinyin, variants }),
  );
}
