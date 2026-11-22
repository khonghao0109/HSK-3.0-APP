import type { Point } from './strokes';

/**
 * Viết (Pha G2d): stroke data for one word, read through the BFF
 * `GET /api/learner/dictionary/strokes?hanzi=`. No Zod here (client bundle);
 * the BFF validated the shape, this only keeps what the board can draw.
 */
export type StrokeCharacter = {
  hanzi: string;
  strokes: string[];
  medians: Point[][];
};

export type StrokeSource = {
  code: string;
  attribution: string;
  referenceUrl: string | null;
};

export type WordStrokes = {
  characters: StrokeCharacter[];
  sources: StrokeSource[];
};

/** null: the word cannot be written (a character without strokes, or a failed read). */
export type StrokeCache = Map<string, Promise<WordStrokes | null>>;

const isPoint = (value: unknown): value is Point =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((n) => typeof n === 'number' && Number.isFinite(n));

function toCharacter(value: unknown): StrokeCharacter | null {
  if (typeof value !== 'object' || value === null) return null;
  const { hanzi, strokes, medians } = value as Record<string, unknown>;
  if (
    typeof hanzi !== 'string' ||
    !Array.isArray(strokes) ||
    !Array.isArray(medians) ||
    strokes.length === 0 ||
    strokes.length !== medians.length ||
    !strokes.every((d) => typeof d === 'string') ||
    !medians.every((m) => Array.isArray(m) && m.length >= 2 && m.every(isPoint))
  )
    return null;
  return { hanzi, strokes, medians };
}

/** Every character of `hanzi` has strokes, or null (Viết stays hidden). */
export function readWordStrokes(
  hanzi: string,
  body: unknown,
): WordStrokes | null {
  if (typeof body !== 'object' || body === null) return null;
  const data = (body as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return null;
  const { characters, sources } = data as Record<string, unknown>;
  if (!Array.isArray(characters) || !Array.isArray(sources)) return null;
  const wanted = [...new Set(Array.from(hanzi))];
  const byHanzi = new Map<string, StrokeCharacter>();
  for (const raw of characters) {
    const character = toCharacter(raw);
    if (character) byHanzi.set(character.hanzi, character);
  }
  const ordered = Array.from(hanzi).map((char) => byHanzi.get(char));
  if (wanted.length === 0 || ordered.some((c) => c === undefined)) return null;
  return {
    characters: ordered.filter((c): c is StrokeCharacter => c !== undefined),
    sources: sources.flatMap((raw: unknown) => {
      if (typeof raw !== 'object' || raw === null) return [];
      const { code, name, attribution, referenceUrl } = raw as Record<
        string,
        unknown
      >;
      // The board credits the source in its own words; the name when it has none.
      const credit =
        typeof attribution === 'string' && attribution
          ? attribution
          : typeof name === 'string'
            ? name
            : null;
      if (typeof code !== 'string' || !credit) return [];
      return [
        {
          code,
          attribution: credit,
          referenceUrl:
            typeof referenceUrl === 'string' &&
            /^https?:\/\//.test(referenceUrl)
              ? referenceUrl
              : null,
        },
      ];
    }),
  };
}

const HAN = /^\p{Script=Han}+$/u;

/** One read per word for the whole unit; failures are cached too (no retry loop). */
export function loadWordStrokes(
  cache: StrokeCache,
  hanzi: string,
): Promise<WordStrokes | null> {
  const known = cache.get(hanzi);
  if (known) return known;
  const pending =
    HAN.test(hanzi) && Array.from(hanzi).length <= 16
      ? fetch(
          `/api/learner/dictionary/strokes?hanzi=${encodeURIComponent(hanzi)}`,
        )
          .then(async (response) =>
            response.ok ? readWordStrokes(hanzi, await response.json()) : null,
          )
          .catch(() => null)
      : Promise.resolve(null);
  cache.set(hanzi, pending);
  return pending;
}
