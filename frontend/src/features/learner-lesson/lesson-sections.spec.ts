import { describe, expect, it } from 'vitest';

import { orderPlayerExercises } from './lesson-player-model';
import {
  lessonUnits,
  parseLessonId,
  unitHref,
  type LessonUnitsInput,
} from './lesson-sections';

type Topic = LessonUnitsInput['topics'][number];

const done = { attemptId: 1 };
const topic = (
  id: number,
  type: string,
  extra: Partial<Topic> = {},
): Topic => ({
  id,
  title: `Topic ${id}`,
  subtitle: null,
  type,
  orderIndex: id,
  progress: { status: 'not_started', completionPercent: 0 },
  exercises: [],
  ...extra,
});
const finished = {
  progress: { status: 'done' as const, completionPercent: 100 },
};

describe('lessonUnits', () => {
  it('makes one unit per topic in orderIndex order, hides ai_speaking (L-units)', () => {
    const units = lessonUnits(
      {
        topics: [
          topic(4, 'key_text', { title: 'Hội thoại: Nhà bạn có mấy người?' }),
          topic(2, 'vocabulary'),
          topic(1, 'vocabulary', finished),
          topic(5, 'ai_speaking'),
          topic(3, 'grammar', { title: 'Câu hỏi số lượng với 几' }),
          topic(6, 'quiz', { exercises: [{ latestAttempt: null }] }),
        ],
        standaloneExercises: [],
        words: [
          { hanzi: '爸爸', topicId: 1 },
          { hanzi: '妈妈', topicId: 1 },
          { hanzi: '哥哥', topicId: 1 },
          { hanzi: '姐姐', topicId: 1 },
          { hanzi: '弟弟', topicId: 1 },
          { hanzi: '家', topicId: 2 },
          { hanzi: '有', topicId: 2 },
          { hanzi: '无', topicId: null },
        ],
      },
      false,
    );
    expect(
      units.map((unit) => [
        unit.kind,
        unit.title,
        unit.meta,
        unit.metaLang,
        unit.slug,
      ]),
    ).toEqual([
      [
        'vocabulary',
        'Từ vựng 1',
        '爸爸 · 妈妈 · 哥哥 · 姐姐',
        'zh-Hans',
        'vocabulary',
      ],
      ['vocabulary', 'Từ vựng 2', '家 · 有', 'zh-Hans', 'vocabulary'],
      ['grammar', 'Ngữ pháp', 'Câu hỏi số lượng với 几', null, 'grammar'],
      [
        'key_text',
        'Bài khoá',
        'Hội thoại: Nhà bạn có mấy người?',
        null,
        'grammar',
      ],
      ['quiz', 'Kiểm tra', 'Mở khi xong các đơn vị trên', null, 'practice'],
    ]);
  });

  it('shows a topic unit as done or as its whole completion percent', () => {
    const units = lessonUnits(
      {
        topics: [
          topic(1, 'vocabulary', finished),
          topic(2, 'grammar', {
            progress: { status: 'learning', completionPercent: 66.6 },
          }),
        ],
        standaloneExercises: [],
        words: [],
      },
      false,
    );
    expect(units.map((unit) => [unit.done, unit.percent])).toEqual([
      [true, 100],
      [false, 67],
    ]);
  });

  it('never shows 100% on an unfinished unit and clamps odd values', () => {
    const units = lessonUnits(
      {
        topics: [
          topic(1, 'vocabulary', {
            progress: { status: 'learning', completionPercent: 99.6 },
          }),
          topic(2, 'grammar', {
            progress: { status: 'learning', completionPercent: -5 },
          }),
        ],
        standaloneExercises: [],
        words: [],
      },
      false,
    );
    expect(units.map((unit) => [unit.done, unit.percent])).toEqual([
      [false, 99],
      [false, 0],
    ]);
  });

  it('falls back to the topic subtitle, then title, for a vocabulary unit without words', () => {
    const units = lessonUnits(
      {
        topics: [
          topic(1, 'vocabulary', { subtitle: 'Chào hỏi' }),
          topic(2, 'vocabulary', { title: 'Saying hello' }),
        ],
        standaloneExercises: [],
        words: [],
      },
      false,
    );
    expect(units.map((unit) => [unit.meta, unit.metaLang])).toEqual([
      ['Chào hỏi', null],
      ['Saying hello', null],
    ]);
  });

  it('puts every exercise of the lesson into one Kiểm tra unit (N1, Pha F)', () => {
    const units = lessonUnits(
      {
        topics: [
          topic(1, 'vocabulary', {
            ...finished,
            exercises: [{ latestAttempt: done }],
          }),
          topic(2, 'quiz', {
            exercises: [{ latestAttempt: done }, { latestAttempt: null }],
          }),
          topic(3, 'quiz', { exercises: [{ latestAttempt: done }] }),
        ],
        standaloneExercises: [{ latestAttempt: null }],
        words: [],
      },
      false,
    );
    expect(units.map((unit) => unit.kind)).toEqual(['vocabulary', 'quiz']);
    expect(units[1]).toMatchObject({
      title: 'Kiểm tra',
      meta: '5 bài tập',
      percent: 60,
      done: false,
      locked: false,
    });
  });

  it('adds a trailing Kiểm tra unit for topic-less exercises of a lesson without quiz topic', () => {
    const units = lessonUnits(
      {
        topics: [],
        standaloneExercises: [{ latestAttempt: done }, { latestAttempt: done }],
        words: [],
      },
      false,
    );
    expect(units).toEqual([
      {
        key: 'quiz',
        kind: 'quiz',
        topicId: null,
        title: 'Kiểm tra',
        meta: '2 bài tập',
        metaLang: null,
        slug: 'practice',
        percent: 100,
        done: true,
        locked: false,
      },
    ]);
  });

  it('locks Kiểm tra until every earlier unit is done (N2)', () => {
    const input = (status: 'learning' | 'done'): LessonUnitsInput => ({
      topics: [
        topic(1, 'vocabulary', finished),
        topic(2, 'grammar', {
          progress: { status, completionPercent: status === 'done' ? 100 : 40 },
        }),
      ],
      standaloneExercises: [{ latestAttempt: null }],
      words: [],
    });
    expect(lessonUnits(input('learning'), false).at(-1)).toMatchObject({
      locked: true,
      meta: 'Mở khi xong các đơn vị trên',
    });
    expect(lessonUnits(input('done'), false).at(-1)).toMatchObject({
      locked: false,
      meta: '1 bài tập',
    });
  });

  it('gates Kiểm tra only on the units placed before it (N2)', () => {
    const units = lessonUnits(
      {
        topics: [
          topic(1, 'vocabulary', finished),
          topic(2, 'quiz', { exercises: [{ latestAttempt: null }] }),
          topic(3, 'key_text'),
        ],
        standaloneExercises: [],
        words: [],
      },
      false,
    );
    expect(units.map((unit) => [unit.kind, unit.locked])).toEqual([
      ['vocabulary', false],
      ['quiz', false],
      ['key_text', false],
    ]);
  });

  it('counts exercises of vocabulary and grammar topics into a trailing Kiểm tra (PO 20/11/2026)', () => {
    const units = lessonUnits(
      {
        topics: [
          topic(1, 'vocabulary', { exercises: [{ latestAttempt: null }] }),
          topic(2, 'grammar', { exercises: [{ latestAttempt: null }] }),
        ],
        standaloneExercises: [],
        words: [],
      },
      false,
    );
    expect(units.map((unit) => [unit.kind, unit.locked])).toEqual([
      ['vocabulary', false],
      ['grammar', false],
      ['quiz', true],
    ]);
  });

  it('hides Kiểm tra when no topic of the lesson has an exercise (5a)', () => {
    const units = lessonUnits(
      {
        topics: [topic(1, 'vocabulary', finished), topic(2, 'grammar')],
        standaloneExercises: [],
        words: [],
      },
      false,
    );
    expect(units.map((unit) => unit.kind)).toEqual(['vocabulary', 'grammar']);
  });

  it('numbers several grammar units, keeps a single one as Ngữ pháp (Pha F)', () => {
    const titles = (types: string[]) =>
      lessonUnits(
        {
          topics: types.map((type, index) => topic(index + 1, type)),
          standaloneExercises: [],
          words: [],
        },
        false,
      ).map((unit) => unit.title);
    expect(
      titles([
        'vocabulary',
        'vocabulary',
        'grammar',
        'grammar',
        'grammar',
        'key_text',
      ]),
    ).toEqual([
      'Từ vựng 1',
      'Từ vựng 2',
      'Ngữ pháp 1',
      'Ngữ pháp 2',
      'Ngữ pháp 3',
      'Bài khoá',
    ]);
    expect(titles(['vocabulary', 'grammar', 'key_text'])).toEqual([
      'Từ vựng 1',
      'Ngữ pháp',
      'Bài khoá',
    ]);
  });

  it('Kiểm tra counts exactly the exercises /practice plays (Pha F)', () => {
    const raw = (id: number, latestAttempt: unknown = null) => ({
      id,
      type: 'mcq',
      prompt: `Câu ${id}`,
      content: {},
      orderIndex: id,
      latestAttempt,
    });
    const topics = [
      topic(1, 'vocabulary', {
        ...finished,
        exercises: [raw(1, done), raw(2)],
      }),
      topic(2, 'grammar', { ...finished, exercises: [raw(3)] }),
      topic(3, 'key_text', finished),
      topic(4, 'ai_speaking', { exercises: [raw(4)] }),
      topic(5, 'quiz', { exercises: [raw(5)] }),
    ];
    const standalone = [raw(6), raw(7)];
    const quiz = lessonUnits(
      { topics, standaloneExercises: standalone, words: [] },
      false,
    ).find((unit) => unit.kind === 'quiz');
    const played = orderPlayerExercises(
      topics.map(({ id, orderIndex, exercises }) => ({
        id,
        orderIndex,
        exercises: exercises as ReturnType<typeof raw>[],
      })),
      standalone,
    );
    expect(played).toHaveLength(7);
    expect(quiz?.meta).toBe(`${played.length} bài tập`);
    expect(quiz?.percent).toBe(14);
  });

  it('hides Kiểm tra when its quiz topics have no exercise (Pha B debt 5a)', () => {
    const units = lessonUnits(
      {
        topics: [topic(1, 'vocabulary', finished), topic(2, 'quiz')],
        standaloneExercises: [],
        words: [],
      },
      false,
    );
    expect(units.map((unit) => unit.kind)).toEqual(['vocabulary']);
  });

  it('opens each topic unit in its own screen, Kiểm tra in the player (N3, Pha D)', () => {
    const units = lessonUnits(
      {
        topics: [
          topic(7, 'vocabulary'),
          topic(8, 'grammar'),
          topic(9, 'key_text'),
        ],
        standaloneExercises: [{ latestAttempt: null }],
        words: [],
      },
      false,
    );
    expect(units.map((unit) => unitHref(12, unit))).toEqual([
      '/learn/lessons/12/vocabulary?unit=7',
      '/learn/lessons/12/grammar?unit=8',
      '/learn/lessons/12/grammar?unit=9',
      '/learn/lessons/12/practice',
    ]);
  });

  it('locks every unit of a locked lesson (Q44)', () => {
    const units = lessonUnits(
      {
        topics: [topic(1, 'vocabulary', finished), topic(2, 'grammar')],
        standaloneExercises: [{ latestAttempt: null }],
        words: [],
      },
      true,
    );
    expect(units.map((unit) => [unit.kind, unit.locked, unit.done])).toEqual([
      ['vocabulary', true, false],
      ['grammar', true, false],
      ['quiz', true, false],
    ]);
  });
});

describe('parseLessonId', () => {
  it.each([
    ['1', 1],
    ['42', 42],
    ['2147483647', 2147483647],
  ])('accepts %s', (raw, id) => {
    expect(parseLessonId(raw)).toBe(id);
  });

  it.each([
    'abc',
    '0',
    '-1',
    '01',
    '1.5',
    ' 1',
    '',
    '2147483648',
    '99999999999',
  ])('rejects %j', (raw) => {
    expect(parseLessonId(raw)).toBeNull();
  });
});
