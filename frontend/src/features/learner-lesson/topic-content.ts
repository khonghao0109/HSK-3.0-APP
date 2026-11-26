/**
 * M2.5f (Q175): blocks of `Topic.content` the learner pages render. Pure and
 * Zod-free so client components may import it. Unknown or malformed blocks are
 * skipped, never rendered raw.
 */

export type GrammarChipRole = 'subj' | 'verb' | 'key' | 'mw' | 'other';

export type GrammarExample = {
  hanzi: string;
  pinyin: string;
  vi: string;
  /** Part of `hanzi` to mark (its first occurrence), or null. */
  highlight: string | null;
};

export type GrammarPointBlock = {
  kind: 'grammar_point';
  title: string;
  formula: { role: GrammarChipRole; zh: string; vi: string }[];
  explanation: string;
  examples: GrammarExample[];
};

export type DialogueLine = {
  speaker: string;
  hanzi: string;
  pinyin: string;
  vi: string;
};

export type DialogueBlock = {
  kind: 'dialogue';
  lines: DialogueLine[];
  /** M2.13d: audio of the whole key text; absent when there is none. */
  audio?: { mediaId: number };
};
/** What a Bài khoá unit shows: dialogues and narrative paragraphs. */
export type KeyTextBlock = DialogueBlock | { kind: 'text'; value: string };

export type TopicBlock =
  | { kind: 'text'; value: string }
  | { kind: 'vocabulary_list' }
  | GrammarPointBlock
  | DialogueBlock;

const CHIP_ROLES: readonly string[] = ['subj', 'verb', 'key', 'mw', 'other'];

type Fields = Record<string, unknown>;

function record(value: unknown): Fields | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Fields)
    : null;
}

/** A trimmed non-empty string, or null. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Every item read by `read`, or null when the list is empty or one fails. */
function list<T>(
  value: unknown,
  read: (item: unknown) => T | null,
): T[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const items: T[] = [];
  for (const item of value) {
    const parsed = read(item);
    if (parsed === null) return null;
    items.push(parsed);
  }
  return items;
}

/** Pha D (N5, N6): one card. A block missing a field is skipped whole. */
function grammarPoint(block: Fields): GrammarPointBlock | null {
  const title = text(block.title);
  const explanation = text(block.explanation);
  const formula = list(block.formula, (item) => {
    const chip = record(item);
    const zh = text(chip?.zh);
    const vi = text(chip?.vi);
    const role = chip?.role;
    return zh && vi && typeof role === 'string' && CHIP_ROLES.includes(role)
      ? { role: role as GrammarChipRole, zh, vi }
      : null;
  });
  const examples = list(block.examples, (item) => {
    const example = record(item);
    const hanzi = text(example?.hanzi);
    const pinyin = text(example?.pinyin);
    const vi = text(example?.vi);
    if (!hanzi || !pinyin || !vi) return null;
    const highlight = text(example?.highlight);
    return {
      hanzi,
      pinyin,
      vi,
      highlight: highlight && hanzi.includes(highlight) ? highlight : null,
    };
  });
  return title && explanation && formula && examples
    ? { kind: 'grammar_point', title, formula, explanation, examples }
    : null;
}

/** Pha D (N7): the turns of a conversation. */
function dialogue(block: Fields): DialogueBlock | null {
  const lines = list(block.lines, (item) => {
    const line = record(item);
    const speaker = text(line?.speaker);
    const hanzi = text(line?.hanzi);
    const pinyin = text(line?.pinyin);
    const vi = text(line?.vi);
    return speaker && hanzi && pinyin && vi
      ? { speaker, hanzi, pinyin, vi }
      : null;
  });
  if (!lines) return null;
  const mediaId = record(block.audio)?.mediaId;
  return typeof mediaId === 'number' &&
    Number.isSafeInteger(mediaId) &&
    mediaId > 0
    ? { kind: 'dialogue', lines, audio: { mediaId } }
    : { kind: 'dialogue', lines };
}

/** The sentence around the first occurrence of `highlight`. */
export function exampleParts(
  hanzi: string,
  highlight: string | null,
): { before: string; mark: string; after: string } | null {
  const at = highlight ? hanzi.indexOf(highlight) : -1;
  if (!highlight || at < 0) return null;
  return {
    before: hanzi.slice(0, at),
    mark: highlight,
    after: hanzi.slice(at + highlight.length),
  };
}

/** N7: a speaker shows as the first letter of the name. */
export function speakerInitial(name: string): string {
  return [...name.trim()][0]?.toLocaleUpperCase('vi') ?? '';
}

/** Speakers alternate two colours, by order of first appearance. */
export function speakerTones(
  speakers: readonly string[],
): Map<string, 'is-a' | 'is-b'> {
  const tones = new Map<string, 'is-a' | 'is-b'>();
  for (const speaker of speakers) {
    if (!tones.has(speaker)) {
      tones.set(speaker, tones.size % 2 === 0 ? 'is-a' : 'is-b');
    }
  }
  return tones;
}

export type LessonTopicKind = 'vocabulary' | 'grammar';

/** Topic types each page shows: key_text reads with the grammar page. */
export const TOPIC_TYPES_BY_PAGE: Record<LessonTopicKind, readonly string[]> = {
  vocabulary: ['vocabulary'],
  grammar: ['grammar', 'key_text'],
};

export function topicBlocks(content: unknown): TopicBlock[] {
  if (!Array.isArray(content)) return [];
  const blocks: TopicBlock[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const { type, value } = block as { type?: unknown; value?: unknown };
    if (type === 'text' && typeof value === 'string' && value.trim() !== '') {
      blocks.push({ kind: 'text', value: value.trim() });
    } else if (type === 'vocabulary_list' && value === 'lesson_words') {
      blocks.push({ kind: 'vocabulary_list' });
    } else if (type === 'grammar_point' || type === 'dialogue') {
      const fields = block as Fields;
      const read =
        type === 'grammar_point' ? grammarPoint(fields) : dialogue(fields);
      if (read) blocks.push(read);
    }
  }
  return blocks;
}

/** Topics of one page, in lesson order. */
export function topicsForPage<T extends { type: string; orderIndex: number }>(
  topics: readonly T[],
  page: LessonTopicKind,
): T[] {
  return topics
    .filter((topic) => TOPIC_TYPES_BY_PAGE[page].includes(topic.type))
    .sort((a, b) => a.orderIndex - b.orderIndex);
}
