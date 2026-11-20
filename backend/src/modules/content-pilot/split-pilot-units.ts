/**
 * Pha F (PO 20/11/2026): chia topic Từ vựng / Ngữ pháp của một bài pilot thành
 * các đơn vị học nhỏ. Chỉ đổi cách nhóm: từ, điểm ngữ pháp và mọi block nội
 * dung giữ nguyên thứ tự và byte. Chạy lại trên file đã chia cho ra cùng file.
 */

/** Tối đa 10 từ một đơn vị Từ vựng. */
export const VOCABULARY_UNIT_MAX_WORDS = 10;
/** Tối đa 2 `grammar_point` một đơn vị Ngữ pháp. */
export const GRAMMAR_UNIT_MAX_POINTS = 2;
/** Một bài có tối đa 3 đơn vị mỗi loại. */
export const MAX_UNITS_PER_TYPE = 3;

type Json = Record<string, unknown>;

const VOCABULARY_MARKER = { type: 'vocabulary_list', value: 'lesson_words' };
/** Topic đơn vị học: bài tập không gắn vào đây (cách B, TL 20/11/2026). */
const UNIT_TOPIC_TYPES = new Set(['vocabulary', 'grammar', 'key_text']);
const UNIT_SUFFIXES = ['', 'b', 'c'] as const;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isMarker = (block: unknown) =>
  isRecord(block) && block.type === 'vocabulary_list';

/**
 * Cỡ từng đơn vị: số đơn vị = min(3, ⌈n/max⌉), chia đều, phần dư cho các đơn
 * vị đầu (mỗi đơn vị một). 25 từ → 9+8+8; 5 điểm → 2+2+1; 3 điểm → 2+1.
 */
export function unitSizes(count: number, max: number): number[] {
  if (count <= 0) return [];
  const units = Math.min(MAX_UNITS_PER_TYPE, Math.ceil(count / max));
  const base = Math.floor(count / units);
  const remainder = count % units;
  return Array.from({ length: units }, (_, index) =>
    index < remainder ? base + 1 : base,
  );
}

function chunk<T>(items: readonly T[], sizes: readonly number[]): T[][] {
  let start = 0;
  return sizes.map((size) => {
    const part = items.slice(start, start + size);
    start += size;
    return part;
  });
}

function topicsOf(lesson: Json, type: string): Json[] {
  return (lesson.topics as unknown[]).filter(
    (topic): topic is Json => isRecord(topic) && topic.type === type,
  );
}

function unitKey(baseKey: string, index: number): string {
  const suffix = UNIT_SUFFIXES[index];
  if (suffix === undefined) throw new Error('quá số đơn vị cho phép');
  return `${baseKey}${suffix}`;
}

/** Topic của đơn vị: giữ cờ của topic gốc, bỏ subtitle ở các đơn vị sau. */
function unitTopic(
  first: Json,
  key: string,
  title: string,
  index: number,
  content: unknown[],
): Json {
  const topic: Json = {};
  for (const [field, value] of Object.entries(first)) {
    if (field === 'subtitle' && index > 0) continue;
    topic[field] = value;
  }
  topic.key = key;
  topic.title = title;
  topic.content = content;
  return topic;
}

function vocabularyUnits(lesson: Json, words: Json[]): Json[] {
  const topics = topicsOf(lesson, 'vocabulary');
  const first = topics[0];
  if (first === undefined) return [];
  const baseKey = String(first.key);
  // Block không phải marker (đoạn giới thiệu) chỉ nằm ở đơn vị đầu.
  const intro = topics.flatMap((topic) =>
    (topic.content as unknown[]).filter((block) => !isMarker(block)),
  );
  const sizes = unitSizes(words.length, VOCABULARY_UNIT_MAX_WORDS);
  if (sizes.length <= 1) {
    for (const word of words) word.topicKey = baseKey;
    return [{ ...first, content: [...intro, { ...VOCABULARY_MARKER }] }];
  }
  return chunk(words, sizes).map((group, index) => {
    const key = unitKey(baseKey, index);
    for (const word of group) word.topicKey = key;
    const head = String(group[0]?.hanzi);
    const tail = String(group[group.length - 1]?.hanzi);
    const title = `Từ vựng (${index + 1}/${sizes.length}): ${head} … ${tail}`;
    const content = index === 0 ? [...intro] : [];
    content.push({ ...VOCABULARY_MARKER });
    return unitTopic(first, key, title, index, content);
  });
}

function grammarUnits(lesson: Json): Json[] {
  const topics = topicsOf(lesson, 'grammar');
  const first = topics[0];
  if (first === undefined) return [];
  const points = topics.flatMap((topic) => topic.content as unknown[]);
  for (const block of points) {
    if (!isRecord(block) || block.type !== 'grammar_point') {
      throw new Error(
        `topic grammar "${String(first.key)}" có block khác grammar_point; không tự chia được`,
      );
    }
  }
  const sizes = unitSizes(points.length, GRAMMAR_UNIT_MAX_POINTS);
  if (sizes.length <= 1) return [{ ...first, content: points }];
  const baseKey = String(first.key);
  return chunk(points, sizes).map((group, index) => {
    const names = group
      .map((point) => String((point as Json).title))
      .join(' · ');
    const title = `Ngữ pháp (${index + 1}/${sizes.length}): ${names}`;
    return unitTopic(first, unitKey(baseKey, index), title, index, group);
  });
}

/** Bản sao của từ không có `topicKey` (dạng trước Pha F). */
export function withoutTopicKey(word: Json): Json {
  const copy = { ...word };
  delete copy.topicKey;
  return copy;
}

/** Trả về bản đã chia (không sửa `raw`). */
export function splitPilotLesson(raw: unknown): Json {
  if (!isRecord(raw)) throw new Error('bài pilot không phải object');
  const lesson = structuredClone(raw);
  if (!Array.isArray(lesson.words) || !Array.isArray(lesson.topics)) {
    throw new Error('bài pilot thiếu words/topics');
  }
  const words = lesson.words.filter(isRecord);
  // Cách B: bài tập chỉ chấm ở Kiểm tra. Chỉ đổi topicKey, giữ vị trí trường.
  const typeOfKey = new Map(
    (lesson.topics as unknown[])
      .filter(isRecord)
      .map((topic) => [topic.key, topic.type]),
  );
  for (const exercise of Array.isArray(lesson.exercises)
    ? lesson.exercises.filter(isRecord)
    : []) {
    if (UNIT_TOPIC_TYPES.has(String(typeOfKey.get(exercise.topicKey)))) {
      exercise.topicKey = null;
    }
  }
  const vocabulary = vocabularyUnits(lesson, words);
  const grammar = grammarUnits(lesson);
  const topics: Json[] = [];
  const emitted = new Set<string>();
  for (const topic of lesson.topics as Json[]) {
    const type = String(topic.type);
    if (type === 'vocabulary' || type === 'grammar') {
      if (!emitted.has(type)) {
        topics.push(...(type === 'vocabulary' ? vocabulary : grammar));
        emitted.add(type);
      }
    } else {
      topics.push(topic);
    }
  }
  for (const [index, topic] of topics.entries()) topic.orderIndex = index + 1;
  lesson.topics = topics;
  return lesson;
}

/**
 * Kiểm toàn vẹn trước/sau: phần nội dung (từ không kể topicKey, chuỗi block
 * không phải marker, bài tập, metadata bài) phải giống từng byte; mỗi topic
 * vocabulary có đúng một marker. Trả về danh sách sai lệch (rỗng = đạt).
 */
export function splitIntegrityIssues(
  before: unknown,
  after: unknown,
): string[] {
  if (!isRecord(before) || !isRecord(after)) return ['không phải object'];
  const issues: string[] = [];
  const same = (label: string, left: unknown, right: unknown) => {
    if (JSON.stringify(left) !== JSON.stringify(right)) issues.push(label);
  };
  const plainWords = (lesson: Json) =>
    (lesson.words as Json[]).map(withoutTopicKey);
  const blocks = (lesson: Json) =>
    (lesson.topics as Json[]).flatMap((topic) =>
      (topic.content as unknown[]).filter((block) => !isMarker(block)),
    );
  const points = (lesson: Json) =>
    blocks(lesson).filter(
      (block) => isRecord(block) && block.type === 'grammar_point',
    );
  same('words', plainWords(before), plainWords(after));
  same('content blocks', blocks(before), blocks(after));
  same('grammar points', points(before), points(after));
  const plainExercises = (lesson: Json) =>
    (lesson.exercises as Json[]).map(withoutTopicKey);
  same('exercises', plainExercises(before), plainExercises(after));
  const unitKeys = new Set(
    (after.topics as Json[])
      .filter((topic) => UNIT_TOPIC_TYPES.has(String(topic.type)))
      .map((topic) => topic.key),
  );
  for (const exercise of after.exercises as Json[]) {
    if (exercise.topicKey !== null && unitKeys.has(exercise.topicKey)) {
      issues.push(
        `exercise ${String(exercise.sourceKey)}: topicKey ${JSON.stringify(exercise.topicKey)} chưa null`,
      );
    }
  }
  for (const field of ['schemaVersion', 'lesson', 'dataSource', 'review']) {
    same(field, before[field], after[field]);
  }
  for (const topic of after.topics as Json[]) {
    if (topic.type !== 'vocabulary') continue;
    const markers = (topic.content as unknown[]).filter(isMarker).length;
    if (markers !== 1)
      issues.push(`topic ${String(topic.key)}: ${markers} marker`);
  }
  return issues;
}
