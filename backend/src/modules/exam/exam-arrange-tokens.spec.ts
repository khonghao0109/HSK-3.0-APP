import type { Prisma } from '@prisma/client';

import { maskArrangeTokens } from './exam-snapshot.builder';

/**
 * TL-133/F9: the authoring form stores `answers.tokens` in the correct order
 * and derives `correctAnswer.tokenIds` from it, so the snapshot must shuffle
 * both the display order and the ids per attempt. These tests inject the RNG so
 * the expected permutation is a worked example, not a re-implementation.
 */
type Tokens = Array<{ id: string; text: string }>;

function fixture(
  tokens: Tokens,
  tokenIds: string[] = tokens.map((token) => token.id),
): { answers: Prisma.JsonValue; correctAnswer: Prisma.JsonValue } {
  return {
    answers: { tokens },
    correctAnswer: { tokenIds },
  };
}

function textSequence(value: Prisma.JsonValue): string[] {
  const tokens = (value as { tokens: Array<{ text: string }> }).tokens;
  return tokens.map((token) => token.text);
}

/** Fisher–Yates with `j = randomInt(max)`; `() => 0` is a fixed permutation. */
const zeroRandom = (maxExclusive: number): number => {
  expect(maxExclusive).toBeGreaterThan(1);
  return 0;
};

const identityRandom = (maxExclusive: number): number => maxExclusive - 1;

describe('maskArrangeTokens (TL-133)', () => {
  const fourTokens: Tokens = [
    { id: 'x1', text: '我' },
    { id: 'x2', text: '爱' },
    { id: 'x3', text: '学习' },
    { id: 'x4', text: '中文' },
  ];

  it('shuffles, renumbers ids by display position and rewrites the answer map', () => {
    const input = fixture(fourTokens);
    const result = maskArrangeTokens(
      input.answers,
      input.correctAnswer,
      zeroRandom,
    );

    // randomInt() === 0 turns [A,B,C,D] into [B,C,D,A].
    expect(result.answers).toEqual({
      tokens: [
        { id: 't1', text: '爱' },
        { id: 't2', text: '学习' },
        { id: 't3', text: '中文' },
        { id: 't4', text: '我' },
      ],
    });
    expect(textSequence(result.answers)).not.toEqual([
      '我',
      '爱',
      '学习',
      '中文',
    ]);
    // Old ids map to the new display ids, in the authoring answer order.
    expect(result.correctAnswer).toEqual({
      tokenIds: ['t4', 't1', 't2', 't3'],
    });

    // Rebuilding from the masked payload yields the correct sentence.
    const tokens = (result.answers as { tokens: Tokens }).tokens;
    const byNewId = new Map(tokens.map((token) => [token.id, token.text]));
    const rebuilt = (
      result.correctAnswer as { tokenIds: string[] }
    ).tokenIds.map((id) => byNewId.get(id));
    expect(rebuilt).toEqual(['我', '爱', '学习', '中文']);
  });

  it('shuffles again when an identity RNG would reveal the answer order', () => {
    const input = fixture(fourTokens);
    const calls: number[] = [];
    const result = maskArrangeTokens(
      input.answers,
      input.correctAnswer,
      (maxExclusive) => {
        calls.push(maxExclusive);
        return identityRandom(maxExclusive);
      },
    );

    // One initial permutation + up to 32 retries, then the forced swap; each
    // Fisher–Yates shuffle calls the RNG once per non-first element (n - 1).
    expect(calls.length).toBeLessThanOrEqual(33 * 3);
    expect(textSequence(result.answers)).not.toEqual([
      '我',
      '爱',
      '学习',
      '中文',
    ]);
    const tokens = (result.answers as { tokens: Tokens }).tokens;
    expect(tokens.map((token) => token.id)).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('always inverts two distinct tokens (no permutation reveals the answer)', () => {
    const input = fixture([
      { id: 'a', text: '一' },
      { id: 'b', text: '二' },
    ]);
    const result = maskArrangeTokens(
      input.answers,
      input.correctAnswer,
      identityRandom,
    );

    expect(textSequence(result.answers)).toEqual(['二', '一']);
    expect(result.correctAnswer).toEqual({ tokenIds: ['t2', 't1'] });
  });

  it('does not loop when every token has the same text', () => {
    const input = fixture([
      { id: 'a', text: '好' },
      { id: 'b', text: '好' },
      { id: 'c', text: '好' },
    ]);
    const calls: number[] = [];
    const result = maskArrangeTokens(
      input.answers,
      input.correctAnswer,
      (maxExclusive) => {
        calls.push(maxExclusive);
        return identityRandom(maxExclusive);
      },
    );

    expect(calls).toEqual([3, 2]);
    expect(
      (result.answers as { tokens: Tokens }).tokens.map((token) => token.text),
    ).toEqual(['好', '好', '好']);
    expect(
      (result.answers as { tokens: Tokens }).tokens.map((token) => token.id),
    ).toEqual(['t1', 't2', 't3']);
  });

  it('does not mutate the input payloads', () => {
    const input = fixture(fourTokens);
    const answersBefore = JSON.stringify(input.answers);
    const correctBefore = JSON.stringify(input.correctAnswer);

    const result = maskArrangeTokens(
      input.answers,
      input.correctAnswer,
      zeroRandom,
    );

    expect(JSON.stringify(input.answers)).toBe(answersBefore);
    expect(JSON.stringify(input.correctAnswer)).toBe(correctBefore);
    expect(result.answers).not.toBe(input.answers);
    expect(result.correctAnswer).not.toBe(input.correctAnswer);
  });

  const invalidPayloads: Array<{
    label: string;
    answers: Prisma.JsonValue;
    correctAnswer: Prisma.JsonValue;
  }> = [
    {
      label: 'no tokens key',
      answers: {},
      correctAnswer: { tokenIds: [] },
    },
    {
      label: 'tokens not an array',
      answers: { tokens: 'nope' },
      correctAnswer: { tokenIds: ['t1'] },
    },
    {
      label: 'unknown answer id',
      ...fixture(
        [
          { id: 'a', text: '一' },
          { id: 'b', text: '二' },
        ],
        ['a', 'zzz'],
      ),
    },
    {
      label: 'duplicate token id',
      ...fixture(
        [
          { id: 'a', text: '一' },
          { id: 'a', text: '二' },
        ],
        ['a'],
      ),
    },
    {
      label: 'missing correctAnswer',
      answers: fixture([{ id: 'a', text: '一' }]).answers,
      correctAnswer: {},
    },
  ];

  it.each(invalidPayloads)(
    'returns the input unchanged for $label',
    ({ answers, correctAnswer }) => {
      const result = maskArrangeTokens(answers, correctAnswer, zeroRandom);

      expect(result.answers).toBe(answers);
      expect(result.correctAnswer).toBe(correctAnswer);
    },
  );
});
