import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';

import {
  LESSON_ACTIVITY_SCORING_VERSION,
  scoreLessonExercise,
} from './lesson-activity-scorer';

describe('Lesson Activity scorer V1', () => {
  const choiceContent = {
    options: [
      { id: 'opt-a', text: '你好' },
      { id: 'opt-b', text: '再见' },
    ],
  };

  it.each(['mcq', 'listening_choice'] as const)(
    'scores %s by stable option id',
    (type) => {
      expect(
        scoreLessonExercise({
          type,
          content: choiceContent,
          authoritativeAnswer: { optionId: 'opt-a' },
          submittedAnswer: { optionId: 'opt-a' },
        }),
      ).toEqual({
        score: 100,
        isCorrect: true,
        feedbackVersion: LESSON_ACTIVITY_SCORING_VERSION,
      });
      expect(
        scoreLessonExercise({
          type,
          content: choiceContent,
          authoritativeAnswer: { optionId: 'opt-a' },
          submittedAnswer: { optionId: 'opt-b' },
        }),
      ).toMatchObject({ score: 0, isCorrect: false });
    },
  );

  it('normalizes fill_blank using NFKC, trim, collapsed whitespace and case-insensitive comparison by default', () => {
    expect(
      scoreLessonExercise({
        type: 'fill_blank',
        content: {},
        authoritativeAnswer: { acceptedTexts: ['ＡBC  你好'] },
        submittedAnswer: { text: '  abc 你好  ' },
      }),
    ).toMatchObject({ score: 100, isCorrect: true });
  });

  it.each([
    ['叫？', '叫?'],
    ['叫?', '叫？'],
    ['（你好）！', '(你好)!'],
    ['你好，老师！', '你好,老师!'],
  ])(
    'accepts fill_blank %j for submitted %j across full-width and ASCII punctuation',
    (accepted, submitted) => {
      for (const caseSensitive of [false, true]) {
        expect(
          scoreLessonExercise({
            type: 'fill_blank',
            content: {},
            authoritativeAnswer: { acceptedTexts: [accepted], caseSensitive },
            submittedAnswer: { text: submitted },
          }),
        ).toMatchObject({ score: 100, isCorrect: true });
      }
    },
  );

  it('supports explicit case-sensitive fill_blank authoring', () => {
    expect(
      scoreLessonExercise({
        type: 'fill_blank',
        content: {},
        authoritativeAnswer: {
          acceptedTexts: ['ABC'],
          caseSensitive: true,
        },
        submittedAnswer: { text: 'abc' },
      }),
    ).toMatchObject({ score: 0, isCorrect: false });
  });

  it('scores arrange_sentence only when the stable token order matches exactly', () => {
    const input = {
      type: 'arrange_sentence' as const,
      content: {
        tokens: [
          { id: 't1', text: '我' },
          { id: 't2', text: '学习' },
          { id: 't3', text: '汉语' },
        ],
      },
      authoritativeAnswer: { tokenIds: ['t1', 't2', 't3'] },
    };
    expect(
      scoreLessonExercise({
        ...input,
        submittedAnswer: { tokenIds: ['t1', 't2', 't3'] },
      }),
    ).toMatchObject({ score: 100, isCorrect: true });
    expect(
      scoreLessonExercise({
        ...input,
        submittedAnswer: { tokenIds: ['t1', 't3', 't2'] },
      }),
    ).toMatchObject({ score: 0, isCorrect: false });
  });

  it.each([
    {
      type: 'mcq' as const,
      content: { options: [{ id: 'a', text: 'A' }] },
      authoritativeAnswer: { optionId: 'missing' },
      submittedAnswer: { optionId: 'a' },
    },
    {
      type: 'fill_blank' as const,
      content: {},
      authoritativeAnswer: { acceptedTexts: [] },
      submittedAnswer: { text: 'x' },
    },
    {
      type: 'arrange_sentence' as const,
      content: { tokens: [{ id: 't1', text: '一' }] },
      authoritativeAnswer: { tokenIds: ['missing'] },
      submittedAnswer: { tokenIds: ['t1'] },
    },
  ])('rejects malformed authoring data without guessing', (input) => {
    expect(() => scoreLessonExercise(input)).toThrow(
      UnprocessableEntityException,
    );
  });

  it('rejects a client answer with the wrong shape', () => {
    expect(() =>
      scoreLessonExercise({
        type: 'mcq',
        content: choiceContent,
        authoritativeAnswer: { optionId: 'opt-a' },
        submittedAnswer: { optionIndex: 0 },
      }),
    ).toThrow(BadRequestException);
  });

  it.each(['option with space', ' option-a', 'option-a\t'])(
    'rejects ambiguous authoring stable ids instead of scoring %p',
    (optionId) => {
      expect(() =>
        scoreLessonExercise({
          type: 'mcq',
          content: {
            options: [
              { id: optionId, text: 'A' },
              { id: 'option-b', text: 'B' },
            ],
          },
          authoritativeAnswer: { optionId },
          submittedAnswer: { optionId },
        }),
      ).toThrow(UnprocessableEntityException);
    },
  );

  it('rejects stable ids that collide after canonical NFKC normalization', () => {
    expect(() =>
      scoreLessonExercise({
        type: 'mcq',
        content: {
          options: [
            { id: 'ｏｐｔ-a', text: 'A' },
            { id: 'opt-a', text: 'B' },
          ],
        },
        authoritativeAnswer: { optionId: 'ｏｐｔ-a' },
        submittedAnswer: { optionId: 'ｏｐｔ-a' },
      }),
    ).toThrow(UnprocessableEntityException);
  });

  it('rejects speaking_repeat instead of creating a fake score', () => {
    expect(() =>
      scoreLessonExercise({
        type: 'speaking_repeat',
        content: {},
        authoritativeAnswer: {},
        submittedAnswer: { audioId: 'fake' },
      }),
    ).toThrow(UnprocessableEntityException);
  });
  describe('matching (Pha E)', () => {
    const content = {
      pairs: [
        { id: 'p1', left: '家', right: 'nhà' },
        { id: 'p2', left: '爸爸', right: 'bố' },
        { id: 'p3', left: '妈妈', right: 'mẹ' },
      ],
    };
    const score = (moves: unknown) =>
      scoreLessonExercise({
        type: 'matching',
        content,
        authoritativeAnswer: {},
        submittedAnswer: { moves },
      });
    const move = (leftId: string, rightId: string) => ({ leftId, rightId });

    it('is correct with no wrong move and counts mistakes from the replayed log', () => {
      expect(
        score([move('p2', 'p2'), move('p1', 'p1'), move('p3', 'p3')]),
      ).toEqual({
        score: 100,
        isCorrect: true,
        mistakes: 0,
        feedbackVersion: LESSON_ACTIVITY_SCORING_VERSION,
      });
      expect(
        score([
          move('p1', 'p2'),
          move('p1', 'p1'),
          move('p3', 'p2'),
          move('p2', 'p2'),
          move('p3', 'p3'),
        ]),
      ).toEqual({
        score: 0,
        isCorrect: false,
        mistakes: 2,
        feedbackVersion: LESSON_ACTIVITY_SCORING_VERSION,
      });
    });

    it.each([
      ['an empty log', []],
      [
        'a log that never matches every pair',
        [move('p1', 'p1'), move('p2', 'p2')],
      ],
      ['an unknown id', [move('p1', 'p9')]],
      [
        'a move on an already matched pair',
        [move('p1', 'p1'), move('p1', 'p2')],
      ],
      [
        'a move after the last pair',
        [
          move('p1', 'p1'),
          move('p2', 'p2'),
          move('p3', 'p3'),
          move('p1', 'p2'),
        ],
      ],
      ['an extra move key', [{ ...move('p1', 'p1'), at: 1 }]],
      ['a non-object move', ['p1:p1']],
      [
        'more than 50 moves',
        Array.from({ length: 51 }, () => move('p1', 'p2')),
      ],
      ['a non-array log', 'p1'],
    ])('rejects %s with 400', (_name, moves) => {
      expect(() => score(moves)).toThrow(BadRequestException);
    });

    it('rejects extra answer keys with 400', () => {
      expect(() =>
        scoreLessonExercise({
          type: 'matching',
          content,
          authoritativeAnswer: {},
          submittedAnswer: { moves: [move('p1', 'p1')], mistakes: 0 },
        }),
      ).toThrow(BadRequestException);
    });
  });
});
