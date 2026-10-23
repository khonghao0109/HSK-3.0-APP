import { describe, expect, it } from 'vitest';

import {
  buildAnswer,
  firstPendingIndex,
  formatClock,
  hasHan,
  isBarPlayed,
  IDEMPOTENCY_KEY_PATTERN,
  newAttemptKey,
  orderPlayerExercises,
  progressClass,
  splitBlank,
  topicToClose,
  WAVE_BARS,
  type PlayerExercise,
} from './lesson-player-model';

function raw(
  id: number,
  orderIndex: number,
  type = 'mcq',
  latestAttempt: unknown = null,
  content: unknown = {
    options: [
      { id: 'a', text: '商店' },
      { id: 'b', text: '超市' },
    ],
  },
) {
  return { id, type, prompt: `Câu ${id}`, content, orderIndex, latestAttempt };
}

const EMPTY = { optionId: null, tokenIds: [], text: '' };

describe('orderPlayerExercises', () => {
  it('orders topics, then their exercises, then standalone ones', () => {
    const list = orderPlayerExercises(
      [
        { id: 2, orderIndex: 2, exercises: [raw(21, 2), raw(20, 1)] },
        { id: 1, orderIndex: 1, exercises: [raw(11, 1), raw(10, 1)] },
      ],
      [raw(31, 2), raw(30, 1)],
    );
    expect(list.map((exercise) => exercise.id)).toEqual([
      10, 11, 20, 21, 30, 31,
    ]);
  });

  it('reads mcq options and arrange tokens', () => {
    const [mcq, arrange, fill] = orderPlayerExercises(
      [],
      [
        raw(1, 1),
        raw(2, 2, 'arrange_sentence', null, {
          tokens: [
            { id: 't1', text: '我' },
            { id: 't2', text: '想' },
          ],
        }),
        raw(3, 3, 'fill_blank', null, {}),
      ],
    );
    expect(mcq).toEqual({
      id: 1,
      topicId: null,
      prompt: 'Câu 1',
      answered: false,
      kind: 'mcq',
      options: [
        { id: 'a', text: '商店' },
        { id: 'b', text: '超市' },
      ],
    });
    expect(arrange).toMatchObject({
      kind: 'arrange_sentence',
      tokens: [
        { id: 't1', text: '我' },
        { id: 't2', text: '想' },
      ],
    });
    expect(fill).toMatchObject({ kind: 'fill_blank' });
  });

  it.each([
    ['listening_choice', undefined],
    ['speaking_repeat', {}],
    ['mcq', { options: [{ id: 'a', text: 'A' }] }],
    [
      'mcq',
      {
        options: [
          { id: 'a', text: 'A' },
          { id: 'a', text: 'B' },
        ],
      },
    ],
    [
      'mcq',
      {
        options: [
          { id: 1, text: 'A' },
          { id: 'b', text: 'B' },
        ],
      },
    ],
    ['mcq', null],
    ['arrange_sentence', { tokens: 'abc' }],
  ])('makes %s with content %j unsupported (Q48)', (type, content) => {
    const [exercise] = orderPlayerExercises(
      [],
      [raw(1, 1, type, null, content)],
    );
    expect(exercise?.kind).toBe('unsupported');
  });

  it('reads listening_choice options and its audio (M2.5c)', () => {
    const [listening] = orderPlayerExercises(
      [],
      [
        {
          ...raw(1, 1, 'listening_choice'),
          media: { id: 7, url: 'x', type: 'audio', duration: 3 },
        },
      ],
    );
    expect(listening).toEqual({
      id: 1,
      topicId: null,
      prompt: 'Câu 1',
      answered: false,
      kind: 'listening',
      options: [
        { id: 'a', text: '商店' },
        { id: 'b', text: '超市' },
      ],
      media: { id: 7, duration: 3 },
    });
  });

  it.each([
    [
      { id: 7, duration: null },
      { id: 7, duration: null },
    ],
    [
      { id: 7, duration: -1 },
      { id: 7, duration: null },
    ],
    [{ id: 7 }, { id: 7, duration: null }],
  ])('keeps media %j as %j', (media, expected) => {
    const [listening] = orderPlayerExercises(
      [],
      [{ ...raw(1, 1, 'listening_choice'), media }],
    );
    expect(listening).toMatchObject({ kind: 'listening', media: expected });
  });

  it.each([null, {}, { id: 0 }, { id: '7' }, { id: 1.5 }, 'media'])(
    'keeps listening_choice with media %j a coming-soon card (Q48)',
    (media) => {
      const [exercise] = orderPlayerExercises(
        [],
        [{ ...raw(1, 1, 'listening_choice'), media }],
      );
      expect(exercise?.kind).toBe('unsupported');
    },
  );

  it('ignores media on other types', () => {
    const [mcq] = orderPlayerExercises(
      [],
      [{ ...raw(1, 1), media: { id: 7, duration: 3 } }],
    );
    expect(mcq).not.toHaveProperty('media');
  });

  it('marks an exercise with a latest attempt as answered', () => {
    const list = orderPlayerExercises(
      [],
      [raw(1, 1, 'mcq', { attemptId: 9 }), raw(2, 2)],
    );
    expect(list.map((exercise) => exercise.answered)).toEqual([true, false]);
  });
});

describe('firstPendingIndex', () => {
  it('starts at the first exercise without an attempt', () => {
    const list = orderPlayerExercises(
      [],
      [raw(1, 1, 'mcq', { attemptId: 1 }), raw(2, 2), raw(3, 3)],
    );
    expect(firstPendingIndex(list)).toBe(1);
  });

  it('returns the length when every exercise has an attempt', () => {
    const list = orderPlayerExercises(
      [],
      [raw(1, 1, 'mcq', { attemptId: 1 }), raw(2, 2, 'mcq', { attemptId: 2 })],
    );
    expect(firstPendingIndex(list)).toBe(2);
    expect(firstPendingIndex([])).toBe(0);
  });
});

describe('topicToClose (Q58)', () => {
  const list = orderPlayerExercises(
    [
      { id: 1, orderIndex: 1, exercises: [raw(10, 1), raw(11, 2)] },
      { id: 2, orderIndex: 2, exercises: [raw(20, 1)] },
    ],
    [raw(30, 1)],
  );

  it('keeps the topic of each exercise, null for standalone ones', () => {
    expect(list.map((exercise) => exercise.topicId)).toEqual([1, 1, 2, null]);
  });

  it('closes a topic after its last exercise once all of it is answered', () => {
    expect(topicToClose(list, 1, new Set([10, 11]))).toBe(1);
    expect(topicToClose(list, 2, new Set([20]))).toBe(2);
  });

  it('does not close before the last exercise, with one unanswered, or for standalone ones', () => {
    expect(topicToClose(list, 0, new Set([10, 11]))).toBeNull();
    expect(topicToClose(list, 1, new Set([11]))).toBeNull();
    expect(topicToClose(list, 3, new Set([10, 11, 20, 30]))).toBeNull();
  });
});

describe('buildAnswer', () => {
  const mcq: PlayerExercise = {
    id: 1,
    topicId: null,
    prompt: 'p',
    answered: false,
    kind: 'mcq',
    options: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
  };
  const arrange: PlayerExercise = {
    id: 2,
    topicId: null,
    prompt: 'p',
    answered: false,
    kind: 'arrange_sentence',
    tokens: [
      { id: 't1', text: '我' },
      { id: 't2', text: '想' },
      { id: 't3', text: '买' },
    ],
  };
  const fill: PlayerExercise = {
    id: 3,
    topicId: null,
    prompt: 'p',
    answered: false,
    kind: 'fill_blank',
  };

  it('sends { optionId } for a known option only', () => {
    expect(buildAnswer(mcq, { ...EMPTY, optionId: 'b' })).toEqual({
      optionId: 'b',
    });
    expect(buildAnswer(mcq, EMPTY)).toBeNull();
    expect(buildAnswer(mcq, { ...EMPTY, optionId: 'z' })).toBeNull();
  });

  it('sends { tokenIds } once every token is placed, in placed order', () => {
    expect(
      buildAnswer(arrange, { ...EMPTY, tokenIds: ['t3', 't1', 't2'] }),
    ).toEqual({ tokenIds: ['t3', 't1', 't2'] });
    expect(
      buildAnswer(arrange, { ...EMPTY, tokenIds: ['t1', 't2'] }),
    ).toBeNull();
    expect(
      buildAnswer(arrange, { ...EMPTY, tokenIds: ['t1', 't1', 't2'] }),
    ).toBeNull();
    expect(
      buildAnswer(arrange, { ...EMPTY, tokenIds: ['t1', 't2', 'x'] }),
    ).toBeNull();
  });

  it('sends trimmed { text } of 1 to 4096 characters', () => {
    expect(buildAnswer(fill, { ...EMPTY, text: '  好 ' })).toEqual({
      text: '好',
    });
    expect(buildAnswer(fill, { ...EMPTY, text: '   ' })).toBeNull();
    expect(buildAnswer(fill, { ...EMPTY, text: 'a'.repeat(4096) })).toEqual({
      text: 'a'.repeat(4096),
    });
    expect(buildAnswer(fill, { ...EMPTY, text: 'a'.repeat(4097) })).toBeNull();
  });

  it('never builds an answer for an unsupported exercise', () => {
    expect(
      buildAnswer(
        {
          id: 4,
          topicId: null,
          prompt: 'p',
          answered: false,
          kind: 'unsupported',
        },
        { optionId: 'a', tokenIds: ['a'], text: 'a' },
      ),
    ).toBeNull();
  });
});

describe('player helpers', () => {
  it('splits a prompt around its blank', () => {
    expect(splitBlank('我___你')).toEqual(['我', '你']);
    expect(splitBlank('你＿＿')).toEqual(['你', '']);
    expect(splitBlank('Điền từ')).toEqual(['Điền từ ', '']);
    expect(splitBlank('a_b')).toEqual(['a_b ', '']);
  });

  it('detects Han text', () => {
    expect(hasHan('超市')).toBe(true);
    expect(hasHan('Hello')).toBe(false);
  });

  it('maps progress to a pct class', () => {
    expect(progressClass(0, 0)).toBe('pct-0');
    expect(progressClass(1, 3)).toBe('pct-33');
    expect(progressClass(3, 3)).toBe('pct-100');
    expect(progressClass(5, 3)).toBe('pct-100');
  });

  it('makes a fresh key the backend accepts', () => {
    const first = newAttemptKey();
    expect(first).toMatch(IDEMPOTENCY_KEY_PATTERN);
    expect(newAttemptKey()).not.toBe(first);
  });
});

describe('listening helpers', () => {
  it('has the 67 bars of mẫu 05 (Q55)', () => {
    expect(WAVE_BARS).toHaveLength(67);
  });

  it('plays bars by share of the track', () => {
    expect(WAVE_BARS.filter(([x]) => isBarPlayed(x, 0))).toHaveLength(0);
    expect(WAVE_BARS.filter(([x]) => isBarPlayed(x, 1))).toHaveLength(67);
    expect(WAVE_BARS.filter(([x]) => isBarPlayed(x, 0.5)).length).toBe(
      WAVE_BARS.filter(([x]) => x < 134).length,
    );
  });

  it.each([
    [0, '0:00'],
    [2.9, '0:02'],
    [3, '0:03'],
    [65, '1:05'],
    [600, '10:00'],
    [-1, '0:00'],
    [Number.NaN, '0:00'],
    [Number.POSITIVE_INFINITY, '0:00'],
  ])('formats %d seconds as %s', (seconds, text) => {
    expect(formatClock(seconds)).toBe(text);
  });

  it('builds { optionId } for listening like mcq', () => {
    const listening: PlayerExercise = {
      id: 1,
      topicId: null,
      prompt: 'p',
      answered: false,
      kind: 'listening',
      options: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
      media: { id: 7, duration: 3 },
    };
    expect(buildAnswer(listening, { ...EMPTY, optionId: 'b' })).toEqual({
      optionId: 'b',
    });
    expect(buildAnswer(listening, { ...EMPTY, optionId: 'z' })).toBeNull();
    expect(buildAnswer(listening, EMPTY)).toBeNull();
  });
});
