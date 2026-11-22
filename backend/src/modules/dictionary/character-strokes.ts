import { ValidationError } from 'class-validator';

import { createSafeValidationException } from '../../common/validation/safe-validation-exception.factory';
import type {
  CharacterStrokesDto,
  CharacterStrokesResponseDto,
  CharacterStrokesSourceDto,
} from './dto/character-strokes-response.dto';

export const STROKES_MAX_RAW_CHARS = 16;
export const STROKES_MAX_CHARS = 8;
const HAN = /^\p{Script=Han}$/u;

function invalid(code: string): never {
  const error = new ValidationError();
  error.property = 'hanzi';
  error.constraints = { [code]: code };
  throw createSafeValidationException([error]);
}

/** Validates `?hanzi=` and returns its distinct characters in order (code points). */
export function parseStrokesHanzi(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.length === 0) invalid('isNotEmpty');
  const chars = Array.from(raw);
  if (chars.length > STROKES_MAX_RAW_CHARS) invalid('maxLength');
  if (!chars.every((c) => HAN.test(c))) invalid('isHanzi');
  const distinct = [...new Set(chars)];
  if (distinct.length > STROKES_MAX_CHARS) invalid('arrayMaxSize');
  return distinct;
}

export interface CharacterStrokesRow {
  hanzi: string;
  strokeCount: number | null;
  strokeData: unknown;
  dataSource: CharacterStrokesSourceDto | null;
}

function isPoint(p: unknown): boolean {
  return (
    Array.isArray(p) &&
    p.length === 2 &&
    p.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/** `strokeData` is untrusted JSON: returns it only when it has the stored shape. */
export function readStrokeData(
  data: unknown,
): { strokes: string[]; medians: number[][][] } | null {
  if (typeof data !== 'object' || data === null) return null;
  const { strokes, medians } = data as Record<string, unknown>;
  if (!Array.isArray(strokes) || !Array.isArray(medians)) return null;
  if (strokes.length === 0 || strokes.length !== medians.length) return null;
  if (!strokes.every((s) => typeof s === 'string')) return null;
  if (!medians.every((m) => Array.isArray(m) && m.every(isPoint))) return null;
  return { strokes, medians: medians as number[][][] };
}

export function toCharacterStrokesResponse(
  hanzi: readonly string[],
  rows: readonly CharacterStrokesRow[],
): CharacterStrokesResponseDto {
  const byHanzi = new Map(rows.map((row) => [row.hanzi, row]));
  const sources = new Map<string, CharacterStrokesSourceDto>();
  const characters = hanzi.map((char): CharacterStrokesDto => {
    const row = byHanzi.get(char);
    const data = row ? readStrokeData(row.strokeData) : null;
    if (!row || !data)
      return {
        hanzi: char,
        strokeCount: null,
        strokes: null,
        medians: null,
        sourceCode: null,
      };
    if (row.dataSource) sources.set(row.dataSource.code, row.dataSource);
    return {
      hanzi: char,
      strokeCount: row.strokeCount ?? data.strokes.length,
      strokes: data.strokes,
      medians: data.medians,
      sourceCode: row.dataSource?.code ?? null,
    };
  });
  return { characters, sources: [...sources.values()] };
}
