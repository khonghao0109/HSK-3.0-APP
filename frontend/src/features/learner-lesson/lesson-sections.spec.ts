import { describe, expect, it } from 'vitest';

import {
  lessonUnits,
  parseLessonId,
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

  it('puts quiz-topic and topic-less exercises into one Kiểm tra unit (N1)', () => {
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
      meta: '4 bài tập',
      percent: 50,
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

  it('has no Kiểm tra unit when the lesson has no quiz topic nor topic-less exercise', () => {
    const units = lessonUnits(
      {
        topics: [
          topic(1, 'vocabulary', { exercises: [{ latestAttempt: null }] }),
        ],
        standaloneExercises: [],
        words: [],
      },
      false,
    );
    expect(units.map((unit) => unit.kind)).toEqual(['vocabulary']);
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
