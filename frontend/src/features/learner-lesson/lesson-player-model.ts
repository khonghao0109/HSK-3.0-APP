// Kept free of Zod: the player is a client component and the CSP blocks
// Zod's Function() probe (frontend/AGENTS.md).

export type PlayerChoice = { id: string; text: string };

export type PlayerExercise = {
  id: number;
  prompt: string;
  answered: boolean;
} & (
  | { kind: 'mcq'; options: PlayerChoice[] }
  | { kind: 'arrange_sentence'; tokens: PlayerChoice[] }
  | { kind: 'fill_blank' }
  // listening_choice until M2.5c, and any shape the player cannot read (Q48).
  | { kind: 'unsupported' }
);

export type PlayerAnswer =
  { optionId: string } | { tokenIds: string[] } | { text: string };

/**
 * The attempt DTO sets no length; 4096 is the longest accepted text an
 * author can save (LESSON_EXERCISE_AUTHORING_LIMITS.maxStringLength), so a
 * longer answer can never be right.
 */
export const FILL_BLANK_MAX_LENGTH = 4096;

/** Backend `IDEMPOTENCY_KEY_PATTERN` (docs/api/api.md §A.7). */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

type RawExercise = {
  id: number;
  type: string;
  prompt: string;
  content: unknown;
  orderIndex: number;
  latestAttempt: unknown;
};

type RawTopic = { id: number; orderIndex: number; exercises: RawExercise[] };

function byOrder<T extends { id: number; orderIndex: number }>(
  a: T,
  b: T,
): number {
  return a.orderIndex - b.orderIndex || a.id - b.id;
}

function readChoices(content: unknown, key: string): PlayerChoice[] | null {
  if (typeof content !== 'object' || content === null) return null;
  const list: unknown = Reflect.get(content, key);
  if (!Array.isArray(list) || list.length < 2) return null;
  const choices: PlayerChoice[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) return null;
    const id: unknown = Reflect.get(item, 'id');
    const text: unknown = Reflect.get(item, 'text');
    if (typeof id !== 'string' || typeof text !== 'string' || !id) return null;
    if (choices.some((choice) => choice.id === id)) return null;
    choices.push({ id, text });
  }
  return choices;
}

function toPlayerExercise(raw: RawExercise): PlayerExercise {
  const base = {
    id: raw.id,
    prompt: raw.prompt,
    answered: raw.latestAttempt !== null,
  };
  if (raw.type === 'mcq') {
    const options = readChoices(raw.content, 'options');
    if (options) return { ...base, kind: 'mcq', options };
  } else if (raw.type === 'arrange_sentence') {
    const tokens = readChoices(raw.content, 'tokens');
    if (tokens) return { ...base, kind: 'arrange_sentence', tokens };
  } else if (raw.type === 'fill_blank') {
    return { ...base, kind: 'fill_blank' };
  }
  return { ...base, kind: 'unsupported' };
}

/** Topic exercises by topic then exercise orderIndex, then standalone ones. */
export function orderPlayerExercises(
  topics: RawTopic[],
  standalone: RawExercise[],
): PlayerExercise[] {
  const fromTopics = [...topics]
    .sort(byOrder)
    .flatMap((topic) => [...topic.exercises].sort(byOrder));
  return [...fromTopics, ...[...standalone].sort(byOrder)].map(
    toPlayerExercise,
  );
}

/** First exercise without an attempt; `length` when every one has one. */
export function firstPendingIndex(exercises: PlayerExercise[]): number {
  const index = exercises.findIndex((exercise) => !exercise.answered);
  return index === -1 ? exercises.length : index;
}

export type PlayerInput = {
  optionId: string | null;
  tokenIds: string[];
  text: string;
};

/** Attempt `answer` for the exercise type, or null while it is incomplete. */
export function buildAnswer(
  exercise: PlayerExercise,
  input: PlayerInput,
): PlayerAnswer | null {
  switch (exercise.kind) {
    case 'mcq': {
      const { optionId } = input;
      return optionId !== null &&
        exercise.options.some((option) => option.id === optionId)
        ? { optionId }
        : null;
    }
    case 'arrange_sentence': {
      const { tokenIds } = input;
      const all = exercise.tokens.map((token) => token.id);
      return tokenIds.length === all.length &&
        new Set(tokenIds).size === tokenIds.length &&
        tokenIds.every((id) => all.includes(id))
        ? { tokenIds: [...tokenIds] }
        : null;
    }
    case 'fill_blank': {
      const text = input.text.trim();
      return text.length > 0 && text.length <= FILL_BLANK_MAX_LENGTH
        ? { text }
        : null;
    }
    case 'unsupported':
      return null;
  }
}

/**
 * Splits a fill_blank prompt around its blank (a run of two or more `_`
 * or full-width `＿`). Without a marker the blank goes after the prompt.
 */
export function splitBlank(prompt: string): [string, string] {
  const match = /_{2,}|＿+/u.exec(prompt);
  if (!match) return [prompt.trimEnd() + ' ', ''];
  return [
    prompt.slice(0, match.index),
    prompt.slice(match.index + match[0].length),
  ];
}

/** True when the text holds a Han character (gets `lang="zh-Hans"`). */
export function hasHan(text: string): boolean {
  return /\p{Script=Han}/u.test(text);
}

/** `.pct-N` class (learner.css) for `done` of `total`. */
export function progressClass(done: number, total: number): string {
  if (total <= 0) return 'pct-0';
  return `pct-${Math.min(100, Math.max(0, Math.round((done / total) * 100)))}`;
}

/** Fresh Idempotency-Key for one attempt; reused only to retry it. */
export function newAttemptKey(): string {
  return `attempt-${crypto.randomUUID()}`;
}
