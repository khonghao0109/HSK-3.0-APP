import { describe, expect, it } from 'vitest';

import { answerMark, type UnitWord, unitSteps } from './vocabulary-unit';

const word = (
  id: number,
  meaning: string | null,
  example: UnitWord['example'] = null,
): UnitWord => ({
  id,
  hanzi: `字${id}`,
  pinyin: `zi${id}`,
  meaning,
  firstMeaning: meaning?.split('; ')[0] ?? null,
  partOfSpeech: null,
  image: null,
  example,
});

const example = {
  hanzi: '我家有四口人。',
  pinyin: 'wǒ jiā yǒu sì kǒu rén.',
  vi: 'Nhà tôi có bốn người.',
};

describe('unitSteps (N3, N4)', () => {
  it('gives each word a card, its example when it has one, then a meaning quiz', () => {
    const unit = [word(1, 'nhà', example), word(2, 'có')];
    const pool = [...unit, word(3, 'mấy')];
    expect(unitSteps(unit, pool).map((step) => [step.kind, step.word])).toEqual(
      [
        ['card', 0],
        ['example', 0],
        ['quiz', 0],
        ['card', 1],
        ['quiz', 1],
      ],
    );
  });

  it('builds three options: the meaning and two other lesson meanings, in a fixed order', () => {
    const unit = [word(1, 'nhà'), word(2, 'có')];
    const pool = [...unit, word(3, 'mấy'), word(4, 'miệng')];
    const quizzes = unitSteps(unit, pool).filter(
      (step) => step.kind === 'quiz',
    );
    expect(quizzes).toEqual([
      { kind: 'quiz', word: 0, options: ['có', 'nhà', 'mấy'], answer: 1 },
      { kind: 'quiz', word: 1, options: ['mấy', 'miệng', 'có'], answer: 2 },
    ]);
    // Deterministic: the same input gives the same options.
    expect(unitSteps(unit, pool)).toEqual(unitSteps(unit, pool));
  });

  it('never offers a duplicate or empty meaning as a distractor', () => {
    const unit = [word(1, 'nhà')];
    const pool = [
      ...unit,
      word(2, 'nhà'),
      word(3, null),
      word(4, 'có'),
      word(5, 'có'),
      word(6, 'mấy'),
    ];
    const [quiz] = unitSteps(unit, pool).filter((step) => step.kind === 'quiz');
    expect(quiz).toMatchObject({ options: ['có', 'nhà', 'mấy'], answer: 1 });
  });

  it('skips the quiz of a word without a Vietnamese meaning or without any distractor', () => {
    expect(
      unitSteps([word(1, null)], [word(1, null), word(2, 'có')]).map(
        (step) => step.kind,
      ),
    ).toEqual(['card']);
    expect(
      unitSteps([word(1, 'nhà')], [word(1, 'nhà')]).map((step) => step.kind),
    ).toEqual(['card']);
  });
});

// Pha C debt 3b: the mark says how many times the word was answered wrong.
describe('answerMark', () => {
  it('marks a right answer, and counts the wrong ones (mẫu "Sai 1 lần")', () => {
    expect(answerMark(0)).toEqual({ tone: 'is-ok', text: 'Đúng' });
    expect(answerMark(1)).toEqual({ tone: 'is-wrong', text: 'Sai 1 lần' });
    expect(answerMark(2)).toEqual({ tone: 'is-wrong', text: 'Sai 2 lần' });
    expect(answerMark(undefined)).toBeNull();
  });
});
