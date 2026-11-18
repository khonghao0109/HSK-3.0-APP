import { Prisma, PrismaClient } from '@prisma/client';

import { canonicalJson } from '../../common/utils/canonical-json';

/**
 * Q357: nạp nét chữ Make Me a Hanzi (`graphics.txt`, Arphic Public License) vào
 * `Character.strokeData` / `strokeCount`. Idempotent theo `hanzi`; chỉ ghi đè chữ
 * chưa có nguồn hoặc cùng nguồn `MAKEMEAHANZI_GRAPHICS`; không đụng pinyin/Hán Việt.
 */
export const MAKEMEAHANZI_SOURCE_CODE = 'MAKEMEAHANZI_GRAPHICS';

export interface HanziGraphics {
  readonly character: string;
  readonly strokes: readonly string[];
  readonly medians: readonly (readonly (readonly [number, number])[])[];
}

const SVG_PATH = /^M[\d\s.MLQCZ-]+$/u;

/** Đọc JSONL, kiểm từng dòng; ném lỗi kèm số dòng. */
export function parseHanziGraphics(text: string): HanziGraphics[] {
  const out: HanziGraphics[] = [];
  const seen = new Set<string>();
  for (const [index, line] of text.split('\n').entries()) {
    if (!line.trim()) continue;
    const at = `dòng ${index + 1}`;
    const row = JSON.parse(line) as Partial<HanziGraphics>;
    const { character, strokes, medians } = row;
    if (typeof character !== 'string' || [...character].length !== 1)
      throw new Error(`${at}: character phải đúng 1 ký tự`);
    if (seen.has(character)) throw new Error(`${at}: trùng ${character}`);
    seen.add(character);
    if (!Array.isArray(strokes) || strokes.length === 0)
      throw new Error(`${at}: ${character} thiếu strokes`);
    if (
      !strokes.every((path) => typeof path === 'string' && SVG_PATH.test(path))
    )
      throw new Error(`${at}: ${character} có stroke không phải SVG path`);
    if (!Array.isArray(medians) || medians.length !== strokes.length)
      throw new Error(`${at}: ${character} số medians khác số strokes`);
    for (const median of medians) {
      if (
        !Array.isArray(median) ||
        median.length < 2 ||
        !median.every(
          (point) =>
            Array.isArray(point) &&
            point.length === 2 &&
            point.every((value) => Number.isFinite(value)),
        )
      )
        throw new Error(`${at}: ${character} median sai định dạng`);
    }
    out.push({ character, strokes, medians });
  }
  return out;
}

export interface StrokeImportResult {
  created: number;
  updated: number;
  unchanged: number;
  skippedOtherSource: string[];
}

export async function importHanziStrokes(
  prisma: PrismaClient,
  rows: readonly HanziGraphics[],
): Promise<StrokeImportResult> {
  const source = await prisma.dataSource.findUnique({
    where: { code: MAKEMEAHANZI_SOURCE_CODE },
    select: { id: true },
  });
  if (!source)
    throw new Error(
      `Thiếu DataSource ${MAKEMEAHANZI_SOURCE_CODE} (chạy migrate)`,
    );
  const result: StrokeImportResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    skippedOtherSource: [],
  };
  const existing = new Map(
    (
      await prisma.character.findMany({
        where: { hanzi: { in: rows.map((row) => row.character) } },
        select: {
          hanzi: true,
          strokeCount: true,
          strokeData: true,
          dataSourceId: true,
        },
      })
    ).map((row) => [row.hanzi, row]),
  );
  for (const row of rows) {
    const strokeData = {
      strokes: row.strokes,
      medians: row.medians,
    } as unknown as Prisma.InputJsonValue;
    const current = existing.get(row.character);
    if (!current) {
      await prisma.character.create({
        data: {
          hanzi: row.character,
          strokeCount: row.strokes.length,
          strokeData,
          dataSourceId: source.id,
        },
      });
      result.created += 1;
      continue;
    }
    if (current.dataSourceId !== null && current.dataSourceId !== source.id) {
      result.skippedOtherSource.push(row.character);
      continue;
    }
    if (
      current.dataSourceId === source.id &&
      current.strokeCount === row.strokes.length &&
      // jsonb sắp lại thứ tự key: so dạng canonical.
      canonicalJson(current.strokeData) === canonicalJson(strokeData)
    ) {
      result.unchanged += 1;
      continue;
    }
    await prisma.character.update({
      where: { hanzi: row.character },
      data: {
        strokeCount: row.strokes.length,
        strokeData,
        dataSourceId: source.id,
      },
    });
    result.updated += 1;
  }
  return result;
}
