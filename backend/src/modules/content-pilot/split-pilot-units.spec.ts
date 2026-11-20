import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  splitIntegrityIssues,
  splitPilotLesson,
  unitSizes,
  withoutTopicKey,
} from './split-pilot-units';
import {
  loadPilotReferenceData,
  validatePilotLesson,
} from './pilot-content.validator';

const BACKEND_ROOT = join(__dirname, '../../..');
const CONTENT_DIR = join(BACKEND_ROOT, 'content/pilot/hsk1');

type Json = Record<string, unknown>;

const read = (name: string) =>
  JSON.parse(readFileSync(join(CONTENT_DIR, name), 'utf8')) as Json;

/** topicKey của 10 bài tập bài 1 trước Pha F (e01…e10), theo git trước khi chia. */
const LESSON_01_EXERCISE_TOPICS = [
  't01',
  't02',
  't02',
  't01',
  't02',
  't02',
  't01',
  't02',
  't02',
  't02',
];

/** Bài 1 gom lại thành 1 topic vocabulary + 1 topic grammar như trước Pha F. */
function unsplitLesson01(): Json {
  const lesson = read('lesson-01.json');
  const topics = lesson.topics as Json[];
  const vocabulary = topics.filter((topic) => topic.type === 'vocabulary');
  const grammar = topics.filter((topic) => topic.type === 'grammar');
  const keyText = topics.filter((topic) => topic.type === 'key_text');
  lesson.topics = [
    {
      ...vocabulary[0],
      key: 't01',
      title: 'Từ vựng',
      orderIndex: 1,
      content: [
        ...vocabulary.flatMap((topic) =>
          (topic.content as Json[]).filter(
            (block) => block.type !== 'vocabulary_list',
          ),
        ),
        { type: 'vocabulary_list', value: 'lesson_words' },
      ],
    },
    {
      ...grammar[0],
      key: 't02',
      title: 'Ngữ pháp',
      orderIndex: 2,
      content: grammar.flatMap((topic) => topic.content as Json[]),
    },
    ...keyText.map((topic) => ({ ...topic, orderIndex: 3 })),
  ];
  lesson.words = (lesson.words as Json[]).map(withoutTopicKey);
  (lesson.exercises as Json[]).forEach((exercise, index) => {
    exercise.topicKey = LESSON_01_EXERCISE_TOPICS[index];
  });
  return lesson;
}

const shape = (lesson: Json) =>
  (lesson.topics as Json[]).map((topic) => [
    topic.key,
    topic.type,
    topic.orderIndex,
  ]);

describe('Chia đơn vị học của bài pilot (Pha F)', () => {
  it.each([
    [20, 10, [10, 10]],
    [18, 10, [9, 9]],
    [25, 10, [9, 8, 8]],
    [40, 10, [14, 13, 13]],
    [7, 10, [7]],
    [3, 2, [2, 1]],
    [4, 2, [2, 2]],
    [5, 2, [2, 2, 1]],
    [2, 2, [2]],
  ])('%i mục, tối đa %i → %j', (count, max, expected) => {
    expect(unitSizes(count, max)).toEqual(expected);
  });

  it('bài 1 (20 từ, 5 điểm): t01 t01b | t02 t02b t02c | t03, orderIndex 1..6', () => {
    const split = splitPilotLesson(unsplitLesson01());
    expect(shape(split)).toEqual([
      ['t01', 'vocabulary', 1],
      ['t01b', 'vocabulary', 2],
      ['t02', 'grammar', 3],
      ['t02b', 'grammar', 4],
      ['t02c', 'grammar', 5],
      ['t03', 'key_text', 6],
    ]);
    const words = split.words as Json[];
    expect(words.map((word) => word.topicKey)).toEqual([
      ...Array<string>(10).fill('t01'),
      ...Array<string>(10).fill('t01b'),
    ]);
    const topics = split.topics as Json[];
    expect(topics[0]?.title).toBe(
      `Từ vựng (1/2): ${String(words[0]?.hanzi)} … ${String(words[9]?.hanzi)}`,
    );
    expect(topics[1]?.title).toBe(
      `Từ vựng (2/2): ${String(words[10]?.hanzi)} … ${String(words[19]?.hanzi)}`,
    );
    expect(topics[1]?.content).toEqual([
      { type: 'vocabulary_list', value: 'lesson_words' },
    ]);
    expect(topics[1]).not.toHaveProperty('subtitle');
    const points = topics
      .slice(2, 5)
      .map((topic) => (topic.content as unknown[]).length);
    expect(points).toEqual([2, 2, 1]);
    expect(topics[2]?.title).toMatch(/^Ngữ pháp \(1\/3\): .+ · .+$/u);
    // Cách B (TL 20/11/2026): bài tập chỉ chấm ở Kiểm tra, nên tách khỏi
    // topic đơn vị (topicKey null); mọi trường khác giữ nguyên.
    const exercises = split.exercises as Json[];
    expect(exercises.map((exercise) => exercise.topicKey)).toEqual(
      Array<null>(10).fill(null),
    );
    expect(exercises.map(withoutTopicKey)).toEqual(
      (unsplitLesson01().exercises as Json[]).map(withoutTopicKey),
    );
  });

  it('bài 25 (18 từ, 4 điểm): 9+9 từ, 2+2 điểm', () => {
    const split = splitPilotLesson(read('lesson-25.json'));
    const topics = split.topics as Json[];
    expect(shape(split).map(([key]) => key)).toEqual([
      't01',
      't01b',
      't02',
      't02b',
      't03',
    ]);
    const counts = (split.words as Json[]).reduce<Record<string, number>>(
      (acc, word) => {
        const key = String(word.topicKey);
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      {},
    );
    expect(counts).toEqual({ t01: 9, t01b: 9 });
    expect(
      topics
        .filter((topic) => topic.type === 'grammar')
        .map((topic) => (topic.content as unknown[]).length),
    ).toEqual([2, 2]);
  });

  it('idempotent: chia lại bản đã chia cho ra đúng byte cũ', () => {
    const once = splitPilotLesson(unsplitLesson01());
    const twice = splitPilotLesson(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it('toàn vẹn: chỉ đổi cách nhóm, và bản chia qua validator 0 lỗi', () => {
    const before = unsplitLesson01();
    const after = splitPilotLesson(before);
    expect(splitIntegrityIssues(before, after)).toEqual([]);
    expect(
      validatePilotLesson(
        after,
        'lesson-01.json',
        loadPilotReferenceData(BACKEND_ROOT),
      ),
    ).toEqual([]);
  });

  it('kiểm toàn vẹn bắt được bài tập bị đổi nội dung hoặc còn gắn topic đơn vị', () => {
    const before = unsplitLesson01();
    const after = splitPilotLesson(before);
    const exercises = after.exercises as Json[];
    exercises[0].prompt = 'khác';
    exercises[1].topicKey = 't02';
    expect(splitIntegrityIssues(before, after)).toEqual([
      'exercises',
      'exercise pilot-hsk1:l01:e02: topicKey "t02" chưa null',
    ]);
  });

  it('kiểm toàn vẹn bắt được khi một từ hay một điểm ngữ pháp bị đổi', () => {
    const before = unsplitLesson01();
    const after = splitPilotLesson(before);
    (after.words as Json[])[0].meaningVi = 'khác';
    const topics = after.topics as Json[];
    (topics[2]?.content as unknown[]).pop();
    expect(splitIntegrityIssues(before, after)).toEqual([
      'words',
      'content blocks',
      'grammar points',
    ]);
  });
});
