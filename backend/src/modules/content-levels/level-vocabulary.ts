import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Kiểm "nội dung cấp N chỉ dùng từ cấp ≤ N" cho mọi cấp HSK 3.0 (Q356), tổng quát
 * hoá `example_not_hsk1` (pilot, theo chữ) và `segmentWords` (lô nghĩa HSK1, theo từ).
 * Danh sách từ lấy từ `scripts/dictionary/raw/hsk*.json` (GF0025-2021).
 */
export const HSK_LEVELS = [
  'HSK1',
  'HSK2',
  'HSK3',
  'HSK4',
  'HSK5',
  'HSK6',
  'HSK7-9',
] as const;
export type HskLevel = (typeof HSK_LEVELS)[number];

const LEVEL_FILES: Record<HskLevel, string> = {
  HSK1: 'hsk1.json',
  HSK2: 'hsk2.json',
  HSK3: 'hsk3.json',
  HSK4: 'hsk4.json',
  HSK5: 'hsk5.json',
  HSK6: 'hsk6.json',
  'HSK7-9': 'hsk7-9.json',
};

const HAN_RUN = /[\p{Script=Han}〇]+/gu;

export function parseHskLevel(value: string): HskLevel | null {
  const normalized = value.trim().toUpperCase().replace(/_/gu, '-');
  const withPrefix = normalized.startsWith('HSK')
    ? normalized
    : `HSK${normalized}`;
  return (HSK_LEVELS as readonly string[]).includes(withPrefix)
    ? (withPrefix as HskLevel)
    : null;
}

export type LevelLexicon = {
  /** hanzi → cấp thấp nhất có từ đó. */
  levelOf: Map<string, HskLevel>;
  /** Độ dài từ dài nhất (giới hạn vòng quy hoạch động). */
  maxLength: number;
};

export function buildLevelLexicon(
  lists: Partial<Record<HskLevel, readonly string[]>>,
): LevelLexicon {
  const levelOf = new Map<string, HskLevel>();
  let maxLength = 1;
  for (const level of HSK_LEVELS) {
    for (const raw of lists[level] ?? []) {
      const hanzi = raw.trim();
      if (!hanzi || levelOf.has(hanzi)) continue;
      levelOf.set(hanzi, level);
      maxLength = Math.max(maxLength, [...hanzi].length);
    }
  }
  return { levelOf, maxLength };
}

export function loadLevelLexicon(backendRoot: string): LevelLexicon {
  const lists: Partial<Record<HskLevel, string[]>> = {};
  for (const level of HSK_LEVELS) {
    const rows = JSON.parse(
      readFileSync(
        join(backendRoot, 'scripts/dictionary/raw', LEVEL_FILES[level]),
        'utf8',
      ),
    ) as { hanzi: string }[];
    lists[level] = rows.map((row) => row.hanzi);
  }
  return buildLevelLexicon(lists);
}

function rank(level: HskLevel): number {
  return HSK_LEVELS.indexOf(level);
}

export type LevelSegment = {
  text: string;
  /** Cấp thấp nhất của từ; `null` khi không thuộc danh sách nào (chữ lẻ ngoài chuẩn). */
  level: HskLevel | null;
  /** `true` khi từ thuộc cấp ≤ cấp đích, hoặc là tên riêng/từ được phép. */
  allowed: boolean;
};

/**
 * Tách một cụm chữ Hán sao cho ít chữ vượt cấp nhất, rồi ít từ nhất.
 * Các chữ vượt cấp liền nhau được gộp lại; nếu cụm gộp là một từ có trong chuẩn,
 * báo luôn cấp của từ đó (vd. `漂亮` → HSK2 khi đích là HSK1).
 */
export function segmentForLevel(
  han: string,
  target: HskLevel,
  lexicon: LevelLexicon,
  extraAllowed: ReadonlySet<string> = new Set(),
): LevelSegment[] {
  const chars = [...han];
  const limit = rank(target);
  const okWord = (word: string) => {
    if (extraAllowed.has(word)) return true;
    const level = lexicon.levelOf.get(word);
    return level !== undefined && rank(level) <= limit;
  };
  const maxLength = Math.max(
    lexicon.maxLength,
    ...[...extraAllowed].map((w) => [...w].length),
  );
  type Cell = { bad: number; words: number; from: number; ok: boolean };
  const best: (Cell | null)[] = Array.from(
    { length: chars.length + 1 },
    () => null,
  );
  best[0] = { bad: 0, words: 0, from: 0, ok: true };
  for (let end = 1; end <= chars.length; end += 1) {
    for (let start = Math.max(0, end - maxLength); start < end; start += 1) {
      const prev = best[start];
      if (!prev) continue;
      const word = chars.slice(start, end).join('');
      const ok = okWord(word);
      if (!ok && end - start > 1) continue;
      const cell: Cell = {
        bad: prev.bad + (ok ? 0 : 1),
        words: prev.words + 1,
        from: start,
        ok,
      };
      const current = best[end];
      if (
        !current ||
        cell.bad < current.bad ||
        (cell.bad === current.bad && cell.words < current.words)
      ) {
        best[end] = cell;
      }
    }
  }
  const pieces: { text: string; ok: boolean }[] = [];
  for (let end = chars.length; end > 0; ) {
    const cell = best[end] as Cell;
    pieces.unshift({ text: chars.slice(cell.from, end).join(''), ok: cell.ok });
    end = cell.from;
  }
  const merged: { text: string; ok: boolean }[] = [];
  for (const piece of pieces) {
    const last = merged[merged.length - 1];
    if (last && !last.ok && !piece.ok) last.text += piece.text;
    else merged.push({ ...piece });
  }
  return merged.map((piece) => ({
    text: piece.text,
    level: lexicon.levelOf.get(piece.text) ?? null,
    allowed: piece.ok,
  }));
}

export type LevelIssue = {
  code: 'above_level';
  path: string;
  text: string;
  /** Từ vượt cấp (đã mở rộng ra từ trọn trong chuẩn nếu có, vd. 怎么样 thay vì 样). */
  word: string;
  level: HskLevel | null;
  message: string;
};

export type LevelCheckOptions = {
  /** Từ được phép thêm (tên riêng…). */
  allowed?: Iterable<string>;
  /** Bỏ qua các khoá này khi duyệt JSON (ghi chú, nguồn, người duyệt…). */
  ignoreKeys?: Iterable<string>;
};

export const DEFAULT_IGNORED_KEYS = [
  'note',
  'notes',
  'attribution',
  'license',
  'dataSource',
  'review',
  'reviewer',
  'source',
];

/** Dấu chỗ trống / nối mảnh: cụm chữ sát bên là mảnh của một từ (`___关系`, `-边`). */
const FRAGMENT_MARK = /[_＿\-－~～]/u;

const fragmentCache = new WeakMap<LevelLexicon, Map<HskLevel, Set<string>>>();

/** Mọi chuỗi con của các từ cấp ≤ đích. */
function allowedFragments(
  lexicon: LevelLexicon,
  target: HskLevel,
): Set<string> {
  let byLevel = fragmentCache.get(lexicon);
  if (!byLevel)
    fragmentCache.set(lexicon, (byLevel = new Map<HskLevel, Set<string>>()));
  let out = byLevel.get(target);
  if (out) return out;
  out = new Set();
  const limit = rank(target);
  for (const [word, level] of lexicon.levelOf) {
    if (rank(level) > limit) continue;
    const chars = [...word];
    for (let a = 0; a < chars.length; a += 1)
      for (let b = a + 1; b <= chars.length; b += 1)
        out.add(chars.slice(a, b).join(''));
  }
  byLevel.set(target, out);
  return out;
}

/**
 * Từ vượt cấp ngắn nhất trong chuẩn phủ trọn [start, end) và dài hơn đoạn đó
 * (`怎么` + `样` → `怎么样` HSK2), để báo đúng từ người soạn đã dùng.
 */
function widerWord(
  chars: string[],
  start: number,
  end: number,
  target: HskLevel,
  lexicon: LevelLexicon,
): { word: string; level: HskLevel } | null {
  let found: { word: string; level: HskLevel; length: number } | null = null;
  for (let a = start; a >= Math.max(0, end - lexicon.maxLength); a -= 1) {
    for (
      let b = end;
      b <= Math.min(chars.length, a + lexicon.maxLength);
      b += 1
    ) {
      const length = b - a;
      if (length <= end - start) continue;
      const word = chars.slice(a, b).join('');
      const level = lexicon.levelOf.get(word);
      if (!level || rank(level) <= rank(target)) continue;
      if (
        !found ||
        length < found.length ||
        (length === found.length && rank(level) < rank(found.level))
      )
        found = { word, level, length };
    }
  }
  return found;
}

export function checkTextLevel(
  text: string,
  target: HskLevel,
  lexicon: LevelLexicon,
  path = '$',
  allowed: ReadonlySet<string> = new Set(),
): LevelIssue[] {
  const issues: LevelIssue[] = [];
  const runs = [...text.matchAll(HAN_RUN)];
  const fragments = () => allowedFragments(lexicon, target);
  // Từ hợp lệ xuất hiện trong cùng chuỗi: một cụm là chuỗi con của chúng là trích mảnh.
  const context = new Set<string>();
  for (const run of runs)
    for (const segment of segmentForLevel(run[0], target, lexicon, allowed))
      if (segment.allowed && [...segment.text].length > 1)
        context.add(segment.text);
  for (const run of runs) {
    const han = run[0];
    const index = run.index ?? 0;
    const before = text[index - 1] ?? '';
    const after = text[index + han.length] ?? '';
    if (
      (FRAGMENT_MARK.test(before) || FRAGMENT_MARK.test(after)) &&
      fragments().has(han)
    )
      continue;
    if ([...context].some((word) => word !== han && word.includes(han)))
      continue;
    const chars = [...han];
    let offset = 0;
    const segments = segmentForLevel(han, target, lexicon, allowed);
    for (const [i, segment] of segments.entries()) {
      const length = [...segment.text].length;
      const start = offset;
      offset += length;
      if (segment.allowed) continue;
      // 儿 hoá: 点儿, 玩儿… sau một từ hợp lệ.
      if (segment.text === '儿' && i > 0 && segments[i - 1].allowed) continue;
      const report = widerWord(chars, start, offset, target, lexicon) ?? {
        word: segment.text,
        level: segment.level,
      };
      issues.push({
        code: 'above_level',
        path,
        text,
        word: report.word,
        level: report.level,
        message: report.level
          ? `「${report.word}」 là từ ${report.level}, vượt ${target}`
          : `「${report.word}」 không ghép được từ danh sách ≤ ${target}`,
      });
    }
  }
  return issues;
}

/** Tên riêng khai báo trong file (`properNames[].hanzi`) được coi là từ hợp lệ. */
export function collectProperNames(value: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        if (key === 'properNames' && Array.isArray(child)) {
          for (const name of child as { hanzi?: unknown }[])
            if (typeof name?.hanzi === 'string') out.push(name.hanzi);
        } else walk(child);
      }
    }
  };
  walk(value);
  return out;
}

/** Duyệt mọi chuỗi trong JSON và kiểm cấp từng chuỗi có chữ Hán. */
export function checkJsonLevel(
  value: unknown,
  target: HskLevel,
  lexicon: LevelLexicon,
  options: LevelCheckOptions = {},
): LevelIssue[] {
  const ignored = new Set(options.ignoreKeys ?? DEFAULT_IGNORED_KEYS);
  const allowed = new Set([
    ...collectProperNames(value),
    ...(options.allowed ?? []),
  ]);
  const issues: LevelIssue[] = [];
  const walk = (node: unknown, path: string) => {
    if (typeof node === 'string') {
      issues.push(...checkTextLevel(node, target, lexicon, path, allowed));
    } else if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, `${path}[${index}]`));
    } else if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        if (ignored.has(key) || key === 'properNames') continue;
        walk(child, `${path}.${key}`);
      }
    }
  };
  walk(value, '$');
  return issues;
}
