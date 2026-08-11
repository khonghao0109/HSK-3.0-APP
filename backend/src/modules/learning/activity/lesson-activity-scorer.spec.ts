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
});
