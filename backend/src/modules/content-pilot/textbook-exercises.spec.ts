import { validateLessonExerciseAuthoring } from '../../common/validation/lesson-exercise-authoring.validator';

import {
  buildTextbookExercises,
  isClassroomPhrase,
  type ExerciseWord,
} from './textbook-exercises';

const WORDS: ExerciseWord[] = [
  { hanzi: '龘', pinyin: 'dá', meaningVi: 'rồng bay' },
  { hanzi: '鱻', pinyin: 'xiān', meaningVi: 'cá tươi' },
  { hanzi: '毳', pinyin: 'cuì', meaningVi: 'lông tơ' },
  { hanzi: '淼', pinyin: 'miǎo', meaningVi: 'nước mênh mông' },
  { hanzi: '焱', pinyin: 'yàn', meaningVi: 'lửa cháy' },
  { hanzi: '垚', pinyin: 'yáo', meaningVi: 'núi đất cao' },
  { hanzi: '犇', pinyin: 'bēn', meaningVi: 'chạy' },
];

describe('isClassroomPhrase (M2.13b)', () => {
  it.each([
    '上课!',
    '上课！',
    '打开书。',
    '有问题吗？',
    '好吗?',
    '你好，',
    '好,',
  ])('treats %s as a classroom phrase', (hanzi) => {
    expect(isClassroomPhrase(hanzi)).toBe(true);
  });

  it.each(['上课', '老师', '中国', '一点儿', 'A'])(
    'keeps %s as a vocabulary word',
    (hanzi) => {
      expect(isClassroomPhrase(hanzi)).toBe(false);
    },
  );
});

describe('buildTextbookExercises (M2.13b)', () => {
  const build = (words = WORDS.slice(0, 6), pool = WORDS) =>
    buildTextbookExercises('hsk2-textbook:g1:l03', words, pool);

  it('builds matching (3–5 pairs) and both mcq kinds, all CMS-valid', () => {
    const { exercises, skipped } = build();
    const kinds = exercises.map((e) =>
      e.type === 'matching'
        ? 'matching'
        : e.prompt.startsWith('Chọn nghĩa')
          ? 'meaning'
          : 'hanzi',
    );
    expect(kinds.filter((k) => k === 'matching')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'meaning')).toHaveLength(6);
    expect(kinds.filter((k) => k === 'hanzi')).toHaveLength(6);
    expect(skipped).toEqual({ mcqMeaning: 0, mcqHanzi: 0, duplicateWords: 0 });
    expect(exercises.map((e) => e.sourceKey)).toEqual(
      Array.from(
        { length: 14 },
        (_, i) => `hsk2-textbook:g1:l03:e${String(i + 1).padStart(2, '0')}`,
      ),
    );
    expect(exercises.map((e) => e.orderIndex)).toEqual(
      Array.from({ length: 14 }, (_, i) => i + 1),
    );
    for (const exercise of exercises) {
      expect(() =>
        validateLessonExerciseAuthoring(
          {
            type: exercise.type,
            prompt: exercise.prompt,
            content: exercise.content,
            answer: exercise.answer,
            explanation: exercise.explanation,
          },
          'publish',
        ),
      ).not.toThrow();
    }
    const matching = exercises.filter((e) => e.type === 'matching');
    expect(
      matching.map((e) => (e.content as { pairs: unknown[] }).pairs.length),
    ).toEqual([3, 3]);
  });

  it('uses 3 distinct distractors, none equal to the answer', () => {
    for (const exercise of build().exercises.filter((e) => e.type === 'mcq')) {
      const options = (
        exercise.content as { options: { id: string; text: string }[] }
      ).options;
      expect(options).toHaveLength(4);
      expect(new Set(options.map((o) => o.text)).size).toBe(4);
      const answerId = (exercise.answer as { optionId: string }).optionId;
      expect(options.filter((o) => o.id === answerId)).toHaveLength(1);
    }
  });

  it('puts the right answer at varying positions, deterministically', () => {
    const positions = build()
      .exercises.filter((e) => e.type === 'mcq')
      .map((e) => {
        const options = (e.content as { options: { id: string }[] }).options;
        return options.findIndex(
          (o) => o.id === (e.answer as { optionId: string }).optionId,
        );
      });
    expect(new Set(positions).size).toBeGreaterThan(1);
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it('skips and counts a word without three valid distractors', () => {
    // Pool of 3 distinct words: every word has only 2 distractors.
    const { exercises, skipped } = build(WORDS.slice(0, 3), WORDS.slice(0, 3));
    expect(exercises.map((e) => e.type)).toEqual(['matching']);
    expect(skipped).toEqual({ mcqMeaning: 3, mcqHanzi: 3, duplicateWords: 0 });
  });

  it('never offers a distractor that reads like the answer', () => {
    // 骉 and 猋 share the pinyin "biāo": neither may be a distractor of the other.
    const pool: ExerciseWord[] = [
      { hanzi: '骉', pinyin: 'biāo', meaningVi: 'ngựa chạy' },
      { hanzi: '猋', pinyin: 'biāo', meaningVi: 'chó chạy' },
      ...WORDS.slice(0, 2),
    ];
    const { exercises, skipped } = buildTextbookExercises(
      'hsk2-textbook:g1:l09',
      pool.slice(0, 1),
      pool,
    );
    // Meaning question keeps 猋 (its meaning is wrong for 骉); the pinyin
    // question has only 龘 and 鱻 left, so it is skipped.
    expect(exercises.map((e) => e.prompt)).toEqual([
      'Chọn nghĩa đúng của "骉".',
    ]);
    expect(skipped).toEqual({ mcqMeaning: 0, mcqHanzi: 1, duplicateWords: 0 });
  });

  it('builds nothing from no words', () => {
    expect(build([])).toEqual({
      exercises: [],
      skipped: { mcqMeaning: 0, mcqHanzi: 0, duplicateWords: 0 },
    });
  });

  it('counts a word dropped because its meaning or hanzi repeats', () => {
    const words = [
      ...WORDS.slice(0, 4),
      { hanzi: '猋', pinyin: 'biāo', meaningVi: 'rồng bay' },
    ];
    const { exercises, skipped } = build(words);
    expect(skipped).toEqual({ mcqMeaning: 0, mcqHanzi: 0, duplicateWords: 1 });
    expect(exercises.filter((e) => e.type === 'mcq')).toHaveLength(8);
  });
});
