import { InternalServerErrorException } from '@nestjs/common';
import { Skill } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import {
  EXAM_RESULT_DETAIL_SCHEMA_VERSION,
  ExamResultDetailError,
  readExamResultDetail,
} from './exam-result.reader';

/**
 * M4.3 / TL-165: `Result.detailJson` is read back through an explicit
 * allow-list. The tests pin the documented v1 shape and prove that an unknown
 * payload fails closed (server fault) instead of producing a partial result.
 * The client-visible message is fixed; the field path lives only on the error
 * object so the service can log it without echoing stored content.
 */

const UNAVAILABLE_MESSAGE = 'Exam result is unavailable.';

function detail(): Prisma.JsonObject {
  return {
    schemaVersion: EXAM_RESULT_DETAIL_SCHEMA_VERSION,
    attemptScoringVersion: 'hsk-p0-v1',
    snapshotContentHash: 'a'.repeat(64),
    counts: {
      answeredCount: 3,
      correctCount: 2,
      incorrectCount: 1,
      unansweredCount: 1,
    },
    sections: [
      {
        key: 's1',
        skill: Skill.reading,
        questionCount: 2,
        correctCount: 1,
        score: 50,
        maxScore: 100,
      },
      {
        key: 's2',
        skill: Skill.listening,
        questionCount: 2,
        correctCount: 1,
        score: 50,
        maxScore: 100,
      },
    ],
    weakAreas: [
      {
        slug: 'grammar',
        name: 'Ngữ pháp',
        answered: 2,
        correct: 0,
        accuracy: 0,
        level: 'weak',
      },
      {
        slug: 'vocab',
        name: 'Từ vựng',
        answered: 2,
        correct: 1,
        accuracy: 0.5,
        level: 'medium',
      },
    ],
    questions: [
      { key: 'q1', isCorrect: true },
      { key: 'q2', isCorrect: false },
      { key: 'q3', isCorrect: true },
      { key: 'q4', isCorrect: false },
    ],
  };
}

function withDetail(
  mutate: (value: Prisma.JsonObject) => void,
): Prisma.JsonObject {
  const value = detail();
  mutate(value);
  return value;
}

function readerError(run: () => unknown): ExamResultDetailError {
  try {
    run();
  } catch (error: unknown) {
    return error as ExamResultDetailError;
  }
  throw new Error('Expected readExamResultDetail to throw.');
}

function expectInvalid(run: () => unknown, field?: string): void {
  const error = readerError(run);
  expect(error).toBeInstanceOf(InternalServerErrorException);
  expect(error).toBeInstanceOf(ExamResultDetailError);
  expect(error.message).toBe(UNAVAILABLE_MESSAGE);
  expect(error.field).toBe(field);
}

describe('readExamResultDetail (A3/TL-165)', () => {
  it('projects exactly the documented schemaVersion 1 fields', () => {
    expect(readExamResultDetail(detail())).toEqual({
      schemaVersion: 1,
      attemptScoringVersion: 'hsk-p0-v1',
      snapshotContentHash: 'a'.repeat(64),
      counts: {
        answeredCount: 3,
        correctCount: 2,
        incorrectCount: 1,
        unansweredCount: 1,
      },
      sections: [
        {
          key: 's1',
          skill: Skill.reading,
          questionCount: 2,
          correctCount: 1,
          score: 50,
          maxScore: 100,
        },
        {
          key: 's2',
          skill: Skill.listening,
          questionCount: 2,
          correctCount: 1,
          score: 50,
          maxScore: 100,
        },
      ],
      weakAreas: [
        {
          slug: 'grammar',
          name: 'Ngữ pháp',
          answered: 2,
          correct: 0,
          accuracy: 0,
          level: 'weak',
        },
        {
          slug: 'vocab',
          name: 'Từ vựng',
          answered: 2,
          correct: 1,
          accuracy: 0.5,
          level: 'medium',
        },
      ],
      questions: [
        { key: 'q1', isCorrect: true },
        { key: 'q2', isCorrect: false },
        { key: 'q3', isCorrect: true },
        { key: 'q4', isCorrect: false },
      ],
    });
  });

  it('drops an unknown extra key instead of copying it through', () => {
    const value = withDetail((root) => {
      root.correctAnswer = { optionId: 'a' };
      root.explanation = 'Đáp án là A';
    });
    const parsed = readExamResultDetail(value);
    expect(Object.keys(parsed).sort()).toEqual([
      'attemptScoringVersion',
      'counts',
      'questions',
      'schemaVersion',
      'sections',
      'snapshotContentHash',
      'weakAreas',
    ]);
  });

  it('fails closed for a non-object payload', () => {
    expectInvalid(() => readExamResultDetail(null));
    expectInvalid(() => readExamResultDetail([]));
  });

  it('fails closed for another schemaVersion', () => {
    for (const version of [0, 2, '1', null]) {
      const value = withDetail((root) => {
        root.schemaVersion = version;
      });
      expectInvalid(() => readExamResultDetail(value));
    }
  });

  it('fails closed when a required top-level field is missing', () => {
    const value = withDetail((root) => {
      delete root.snapshotContentHash;
    });
    expectInvalid(() => readExamResultDetail(value), 'snapshotContentHash');
  });

  it('fails closed for a malformed counts block', () => {
    const value = withDetail((root) => {
      root.counts = { answeredCount: 1, correctCount: 1 };
    });
    expectInvalid(() => readExamResultDetail(value), 'counts.incorrectCount');
  });

  it('fails closed for a non-numeric number field', () => {
    const value = withDetail((root) => {
      (root.sections as Prisma.JsonArray)[0] = {
        key: 's1',
        skill: Skill.reading,
        questionCount: 'two',
        correctCount: 1,
        score: 50,
        maxScore: 100,
      };
    });
    expectInvalid(
      () => readExamResultDetail(value),
      'sections[0].questionCount',
    );
  });

  it('fails closed for an unknown skill enum', () => {
    const value = withDetail((root) => {
      (root.sections as Prisma.JsonArray)[0] = {
        key: 's1',
        skill: 'grammar',
        questionCount: 2,
        correctCount: 1,
        score: 50,
        maxScore: 100,
      };
    });
    expectInvalid(() => readExamResultDetail(value), 'sections[0].skill');
  });

  it('fails closed for an unknown weak-area level and a duplicate question key', () => {
    const badLevel = withDetail((root) => {
      (root.weakAreas as Prisma.JsonArray)[0] = {
        slug: 'grammar',
        name: 'Ngữ pháp',
        answered: 2,
        correct: 0,
        accuracy: 0,
        level: 'very_weak',
      };
    });
    expectInvalid(() => readExamResultDetail(badLevel), 'weakAreas[0].level');

    const duplicate = withDetail((root) => {
      root.questions = [
        { key: 'q1', isCorrect: true },
        { key: 'q1', isCorrect: false },
      ];
    });
    expectInvalid(() => readExamResultDetail(duplicate), 'questions');
  });

  it('fails closed for a non-boolean correctness flag', () => {
    const value = withDetail((root) => {
      root.questions = [{ key: 'q1', isCorrect: 'yes' }];
    });
    expectInvalid(() => readExamResultDetail(value), 'questions[0].isCorrect');
  });
});
