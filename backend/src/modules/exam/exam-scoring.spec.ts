import { QuestionType, Skill, type Prisma } from '@prisma/client';

import type {
  ExamSnapshotPayload,
  ExamSnapshotQuestion,
} from './exam-snapshot.builder';
import {
  EXAM_SCORING_VERSION,
  ExamScoringError,
  scoreExamAttempt,
  type ExamScoringInput,
  type ExamScoringResult,
  type ExamScoringTag,
} from './exam-scoring';

type QuestionSpec = {
  key: string;
  type: QuestionType;
  correctAnswer: Prisma.JsonValue;
  answers?: Prisma.JsonValue;
  questionId?: number;
  explanation?: string | null;
};

type SectionSpec = {
  skill: Skill;
  questions: QuestionSpec[];
  title?: string;
};

function makeQuestion(
  spec: QuestionSpec,
  skill: Skill,
  orderIndex: number,
): ExamSnapshotQuestion {
  return {
    key: spec.key,
    orderIndex,
    questionId: spec.questionId ?? orderIndex,
    questionVersion: 1,
    type: spec.type,
    skill,
    content: '',
    answers: spec.answers ?? {},
    audio: null,
    image: null,
    correctAnswer: spec.correctAnswer,
    explanation: spec.explanation ?? null,
  };
}

function makePayload(sections: SectionSpec[]): ExamSnapshotPayload {
  return {
    schemaVersion: 1,
    test: {
      id: 1,
      title: 'Đề kiểm tra',
      instruction: null,
      levelCode: 'HSK1',
      durationMinutes: 30,
      passScore: null,
      maxScore: sections.length * 100,
      scoringVersion: 'hsk-p0-v1',
    },
    sections: sections.map((section, sectionIndex) => ({
      key: `s${String(sectionIndex + 1)}`,
      orderIndex: sectionIndex + 1,
      skill: section.skill,
      title: section.title ?? `Phần ${String(sectionIndex + 1)}`,
      instruction: null,
      maxScore: 100,
      groups: [
        {
          key: `s${String(sectionIndex + 1)}-g1`,
          orderIndex: 1,
          title: null,
          instruction: null,
          content: null,
          audio: null,
          image: null,
          questions: section.questions.map((spec, questionIndex) =>
            makeQuestion(
              {
                ...spec,
                questionId:
                  spec.questionId ??
                  (sectionIndex + 1) * 1_000 + questionIndex + 1,
              },
              section.skill,
              questionIndex + 1,
            ),
          ),
        },
      ],
    })),
  };
}

function makeInput(
  payload: ExamSnapshotPayload,
  answers: Array<[string, Prisma.JsonValue]>,
  options: {
    tagsByQuestionId?: Array<[number, ExamScoringTag[]]>;
    passScore?: number | null;
  } = {},
): ExamScoringInput {
  return {
    payload,
    answers: new Map(answers),
    tagsByQuestionId: new Map(options.tagsByQuestionId ?? []),
    passScore:
      options.passScore === undefined
        ? payload.test.passScore
        : options.passScore,
  };
}

function tag(slug: string, name: string = slug): ExamScoringTag {
  return { slug, name };
}

describe('scoreExamAttempt', () => {
  describe('objective question types (Q141)', () => {
    it('marks mcq correct only when choice equals correctAnswer.optionId', () => {
      const payload = makePayload([
        {
          skill: Skill.reading,
          questions: [
            {
              key: 'q1',
              type: QuestionType.mcq,
              correctAnswer: { optionId: 'a' },
              answers: { options: [{ id: 'a' }, { id: 'b' }] },
            },
            {
              key: 'q2',
              type: QuestionType.mcq,
              correctAnswer: { optionId: 'a' },
              answers: { options: [{ id: 'a' }, { id: 'b' }] },
            },
          ],
        },
      ]);

      const result = scoreExamAttempt(
        makeInput(payload, [
          ['q1', { choice: 'a' }],
          ['q2', { choice: 'b' }],
        ]),
      );

      expect(result.questions).toEqual([
        { key: 'q1', isCorrect: true },
        { key: 'q2', isCorrect: false },
      ]);
    });

    it('marks true_false correct only when value equals correctAnswer.value', () => {
      const payload = makePayload([
        {
          skill: Skill.reading,
          questions: [
            {
              key: 'q1',
              type: QuestionType.true_false,
              correctAnswer: { value: true },
            },
            {
              key: 'q2',
              type: QuestionType.true_false,
              correctAnswer: { value: true },
            },
            {
              key: 'q3',
              type: QuestionType.true_false,
              correctAnswer: { value: false },
            },
          ],
        },
      ]);

      const result = scoreExamAttempt(
        makeInput(payload, [
          ['q1', { value: true }],
          ['q2', { value: false }],
          ['q3', { value: false }],
        ]),
      );

      expect(result.questions.map((question) => question.isCorrect)).toEqual([
        true,
        false,
        true,
      ]);
    });

    it('normalizes fill_blank with NFKC, trim, collapsed spaces and case-insensitive comparison', () => {
      const payload = makePayload([
        {
          skill: Skill.reading,
          questions: [
            {
              key: 'q1',
              type: QuestionType.fill_blank,
              correctAnswer: { acceptedTexts: ['你好 世界'] },
            },
            {
              key: 'q2',
              type: QuestionType.fill_blank,
              correctAnswer: { acceptedTexts: ['Học sinh'] },
            },
            {
              key: 'q3',
              type: QuestionType.fill_blank,
              correctAnswer: { acceptedTexts: ['hello'] },
            },
          ],
        },
      ]);

      const result = scoreExamAttempt(
        makeInput(payload, [
          ['q1', { text: '  你好\n世界  ' }],
          ['q2', { text: 'học sinh' }],
          ['q3', { text: 'HeLLo' }],
        ]),
      );

      expect(result.questions.map((question) => question.isCorrect)).toEqual([
        true,
        true,
        true,
      ]);
    });

    it('honours caseSensitive true for fill_blank', () => {
      const payload = makePayload([
        {
          skill: Skill.reading,
          questions: [
            {
              key: 'q1',
              type: QuestionType.fill_blank,
              correctAnswer: { acceptedTexts: ['HSK'], caseSensitive: true },
            },
            {
              key: 'q2',
              type: QuestionType.fill_blank,
              correctAnswer: { acceptedTexts: ['HSK'], caseSensitive: true },
            },
          ],
        },
      ]);

      const result = scoreExamAttempt(
        makeInput(payload, [
          ['q1', { text: 'HSK' }],
          ['q2', { text: 'hsk' }],
        ]),
      );

      expect(result.questions.map((question) => question.isCorrect)).toEqual([
        true,
        false,
      ]);
    });

    it('compares fill_blank against any acceptedTexts entry', () => {
      const payload = makePayload([
        {
          skill: Skill.reading,
          questions: [
            {
              key: 'q1',
              type: QuestionType.fill_blank,
              correctAnswer: { acceptedTexts: ['你好', '您好'] },
            },
          ],
        },
      ]);

      const result = scoreExamAttempt(
        makeInput(payload, [['q1', { text: '您好' }]]),
      );

      expect(result.questions[0]?.isCorrect).toBe(true);
    });

    it('marks arrange_sentence correct only for the whole order (Q142)', () => {
      const payload = makePayload([
        {
          skill: Skill.reading,
          questions: [
            {
              key: 'q1',
              type: QuestionType.arrange_sentence,
              correctAnswer: { tokenIds: ['t1', 't2', 't3'] },
            },
            {
              key: 'q2',
              type: QuestionType.arrange_sentence,
              correctAnswer: { tokenIds: ['t1', 't2', 't3'] },
            },
          ],
        },
      ]);

      const result = scoreExamAttempt(
        makeInput(payload, [
          ['q1', { order: ['t1', 't2', 't3'] }],
          ['q2', { order: ['t1', 't3', 't2'] }],
        ]),
      );

      expect(result.questions.map((question) => question.isCorrect)).toEqual([
        true,
        false,
      ]);
    });

    it('rejects a malformed stored answer instead of guessing (fail closed)', () => {
      const payload = makePayload([
        {
          skill: Skill.reading,
          questions: [
            {
              key: 'q1',
              type: QuestionType.mcq,
              correctAnswer: { optionId: 'a' },
            },
          ],
        },
      ]);

      expect(() =>
        scoreExamAttempt(makeInput(payload, [['q1', { value: 'a' }]])),
      ).toThrow(ExamScoringError);
    });

    it('throws for a question type outside the four objective types', () => {
      const payload = makePayload([
        {
          skill: Skill.listening,
          questions: [
            {
              key: 'q1',
              type: QuestionType.listening,
              correctAnswer: { optionId: 'a' },
            },
          ],
        },
      ]);

      expect(() =>
        scoreExamAttempt(makeInput(payload, [['q1', { choice: 'a' }]])),
      ).toThrow(ExamScoringError);
    });
  });

  describe('score aggregation and rounding (Q143)', () => {
    it.each([
      [1, 1, 100],
      [1, 0, 0],
      [3, 1, 33],
      [3, 2, 67],
      [7, 1, 14],
      [7, 5, 71],
      [9, 4, 44],
      [9, 5, 56],
      [8, 1, 13],
      [40, 1, 3],
      [40, 23, 58],
      [200, 29, 15],
      [2, 1, 50],
      [40, 0, 0],
      [40, 40, 100],
    ])(
      'rounds a %i-question section with %i correct answers to %i',
      (questionCount, correctCount, expectedScore) => {
        const questions: QuestionSpec[] = Array.from(
          { length: questionCount },
          (_, index) => ({
            key: `q${String(index + 1)}`,
            type: QuestionType.mcq,
            correctAnswer: { optionId: 'a' },
          }),
        );
        const answers: Array<[string, Prisma.JsonValue]> = questions.map(
          (question, index) => [
            question.key,
            { choice: index < correctCount ? 'a' : 'b' },
          ],
        );

        const result = scoreExamAttempt(
          makeInput(
            makePayload([{ skill: Skill.reading, questions }]),
            answers,
          ),
        );

        expect(result.sections[0]?.score).toBe(expectedScore);
        expect(result.score).toBe(expectedScore);
        expect(result.maxScore).toBe(100);
      },
    );

    it('sums section scores and aggregates sections of the same skill (Q153)', () => {
      const payload = makePayload([
        {
          skill: Skill.reading,
          questions: [
            {
              key: 'q1',
              type: QuestionType.mcq,
              correctAnswer: { optionId: 'a' },
            },
            {
              key: 'q2',
              type: QuestionType.mcq,
              correctAnswer: { optionId: 'a' },
            },
          ],
        },
        {
          skill: Skill.reading,
          questions: [
            {
              key: 'q3',
              type: QuestionType.mcq,
              correctAnswer: { optionId: 'a' },
            },
            {
              key: 'q4',
              type: QuestionType.mcq,
              correctAnswer: { optionId: 'a' },
            },
          ],
        },
      ]);

      const result = scoreExamAttempt(
        makeInput(payload, [
          ['q1', { choice: 'a' }],
          ['q2', { choice: 'a' }],
          ['q3', { choice: 'a' }],
          ['q4', { choice: 'b' }],
        ]),
      );

      expect(result.sections.map((section) => section.score)).toEqual([
        100, 50,
      ]);
      expect(result.score).toBe(150);
      expect(result.skills).toEqual([
        { skill: Skill.reading, score: 150, total: 200 },
      ]);
      expect(result.maxScore).toBe(200);
    });

    it('keeps the scoring version and maxScore = 100 × section count', () => {
      const payload = makePayload([
        {
          skill: Skill.listening,
          questions: [
            {
              key: 'q1',
              type: QuestionType.mcq,
              correctAnswer: { optionId: 'a' },
            },
          ],
        },
        {
          skill: Skill.reading,
          questions: [
            {
              key: 'q2',
              type: QuestionType.mcq,
              correctAnswer: { optionId: 'a' },
            },
          ],
        },
      ]);

      const result = scoreExamAttempt(
        makeInput(payload, [
          ['q1', { choice: 'a' }],
          ['q2', { choice: 'b' }],
        ]),
      );

      expect(result.scoringVersion).toBe(EXAM_SCORING_VERSION);
      expect(result.maxScore).toBe(200);
      expect(result.skills).toEqual([
        { skill: Skill.listening, score: 100, total: 100 },
        { skill: Skill.reading, score: 0, total: 100 },
      ]);
    });

    it('keeps skill scores summing to the total and never above maxScore (property)', () => {
      const payload = makePayload([
        {
          skill: Skill.reading,
          questions: Array.from({ length: 7 }, (_, index) => ({
            key: `q${String(index + 1)}`,
            type: QuestionType.mcq,
            correctAnswer: { optionId: 'a' },
          })),
        },
        {
          skill: Skill.writing,
          questions: Array.from({ length: 3 }, (_, index) => ({
            key: `w${String(index + 1)}`,
            type: QuestionType.true_false,
            correctAnswer: { value: true },
          })),
        },
      ]);
      const answers: Array<[string, Prisma.JsonValue]> = [
        ...Array.from({ length: 7 }, (_, index): [string, Prisma.JsonValue] => [
          `q${String(index + 1)}`,
          { choice: index % 2 === 0 ? 'a' : 'b' },
        ]),
        ...Array.from({ length: 3 }, (_, index): [string, Prisma.JsonValue] => [
          `w${String(index + 1)}`,
          { value: index !== 1 },
        ]),
      ];

      const result: ExamScoringResult = scoreExamAttempt(
        makeInput(payload, answers),
      );
      const skillSum = result.skills.reduce(
        (sum, skill) => sum + skill.score,
        0,
      );
      const sectionSum = result.sections.reduce(
        (sum, section) => sum + section.score,
        0,
      );

      expect(skillSum).toBe(result.score);
      expect(sectionSum).toBe(result.score);
      expect(result.score).toBeLessThanOrEqual(result.maxScore);
      for (const skill of result.skills) {
        expect(skill.score).toBeLessThanOrEqual(skill.total);
      }
    });
  });

  describe('pass/fail (Q152)', () => {
    function oneQuestionPayload(): ExamSnapshotPayload {
      return makePayload([
        {
          skill: Skill.reading,
          questions: [
            {
              key: 'q1',
              type: QuestionType.mcq,
              correctAnswer: { optionId: 'a' },
            },
            {
              key: 'q2',
              type: QuestionType.mcq,
              correctAnswer: { optionId: 'a' },
            },
            {
              key: 'q3',
              type: QuestionType.mcq,
              correctAnswer: { optionId: 'a' },
            },
            {
              key: 'q4',
              type: QuestionType.mcq,
              correctAnswer: { optionId: 'a' },
            },
          ],
        },
      ]);
    }

    it('returns null when passScore is null', () => {
      const result = scoreExamAttempt(
        makeInput(
          oneQuestionPayload(),
          [
            ['q1', { choice: 'a' }],
            ['q2', { choice: 'b' }],
            ['q3', { choice: 'b' }],
            ['q4', { choice: 'b' }],
          ],
          { passScore: null },
        ),
      );

      expect(result.score).toBe(25);
      expect(result.passed).toBeNull();
    });

    it('passes exactly at the pass boundary and fails one point below', () => {
      const answers: Array<[string, Prisma.JsonValue]> = [
        ['q1', { choice: 'a' }],
        ['q2', { choice: 'b' }],
        ['q3', { choice: 'b' }],
        ['q4', { choice: 'b' }],
      ];
      const payload = oneQuestionPayload();

      const boundary = scoreExamAttempt(
        makeInput(payload, answers, { passScore: 25 }),
      );
      const below = scoreExamAttempt(
        makeInput(payload, answers, { passScore: 26 }),
      );

      expect(boundary.passed).toBe(true);
      expect(below.passed).toBe(false);
    });
  });

  describe('counts and blank answers (Q141/Q146)', () => {
    it('treats a missing or null answer as unanswered and incorrect', () => {
      const payload = makePayload([
        {
          skill: Skill.reading,
          questions: [
            {
              key: 'q1',
              type: QuestionType.mcq,
              correctAnswer: { optionId: 'a' },
            },
            {
              key: 'q2',
              type: QuestionType.mcq,
              correctAnswer: { optionId: 'a' },
            },
            {
              key: 'q3',
              type: QuestionType.mcq,
              correctAnswer: { optionId: 'a' },
            },
          ],
        },
      ]);

      const result = scoreExamAttempt(
        makeInput(payload, [
          ['q1', { choice: 'a' }],
          ['q2', null],
        ]),
      );

      expect(result.questions.map((question) => question.isCorrect)).toEqual([
        true,
        false,
        false,
      ]);
      expect(result.counts).toEqual({
        answeredCount: 1,
        correctCount: 1,
        incorrectCount: 0,
        unansweredCount: 2,
      });
    });

    it('counts answered, correct, incorrect and unanswered across sections', () => {
      const payload = makePayload([
        {
          skill: Skill.reading,
          questions: [
            {
              key: 'q1',
              type: QuestionType.mcq,
              correctAnswer: { optionId: 'a' },
            },
            {
              key: 'q2',
              type: QuestionType.mcq,
              correctAnswer: { optionId: 'a' },
            },
          ],
        },
        {
          skill: Skill.listening,
          questions: [
            {
              key: 'q3',
              type: QuestionType.true_false,
              correctAnswer: { value: true },
            },
            {
              key: 'q4',
              type: QuestionType.true_false,
              correctAnswer: { value: true },
            },
          ],
        },
      ]);

      const result = scoreExamAttempt(
        makeInput(payload, [
          ['q1', { choice: 'a' }],
          ['q2', { choice: 'b' }],
          ['q3', { value: true }],
        ]),
      );

      expect(result.counts).toEqual({
        answeredCount: 3,
        correctCount: 2,
        incorrectCount: 1,
        unansweredCount: 1,
      });
    });
  });

  describe('weak areas (Q154)', () => {
    function tagPayload(
      questionCount: number,
      tagEntries: Array<[number, ExamScoringTag[]]>,
    ) {
      const questions: QuestionSpec[] = Array.from(
        { length: questionCount },
        (_, index) => ({
          key: `q${String(index + 1)}`,
          type: QuestionType.mcq,
          correctAnswer: { optionId: 'a' },
          questionId: index + 1,
        }),
      );
      return {
        payload: makePayload([{ skill: Skill.reading, questions }]),
        tagsByQuestionId: tagEntries,
      };
    }

    it('drops a tag with fewer than two answered questions', () => {
      const { payload, tagsByQuestionId } = tagPayload(2, [
        [1, [tag('mot-cau', 'Một câu')]],
      ]);

      const result = scoreExamAttempt(
        makeInput(
          payload,
          [
            ['q1', { choice: 'b' }],
            ['q2', { choice: 'b' }],
          ],
          { tagsByQuestionId },
        ),
      );

      expect(result.weakAreas).toEqual([]);
    });

    it('does not count a blank answer toward a tag', () => {
      const { payload, tagsByQuestionId } = tagPayload(2, [
        [1, [tag('bo-trong')]],
        [2, [tag('bo-trong')]],
      ]);

      const result = scoreExamAttempt(
        makeInput(
          payload,
          [
            ['q1', { choice: 'b' }],
            ['q2', null],
          ],
          { tagsByQuestionId },
        ),
      );

      expect(result.weakAreas).toEqual([]);
    });

    it('classifies 49/50/69/70 percent and excludes 70 percent or above', () => {
      const questionCount = 200;
      const questions: QuestionSpec[] = Array.from(
        { length: questionCount },
        (_, index) => ({
          key: `q${String(index + 1)}`,
          type: QuestionType.mcq,
          correctAnswer: { optionId: 'a' },
          questionId: index + 1,
        }),
      );
      const payload = makePayload([{ skill: Skill.reading, questions }]);
      const answers: Array<[string, Prisma.JsonValue]> = questions.map(
        (question, index) => [
          question.key,
          { choice: index < 100 ? 'a' : 'b' },
        ],
      );
      const tagMap = new Map<number, ExamScoringTag[]>();
      const addTag = (ids: number[], value: ExamScoringTag): void => {
        for (const id of ids) {
          tagMap.set(id, [...(tagMap.get(id) ?? []), value]);
        }
      };
      const range = (from: number, count: number): number[] =>
        Array.from({ length: count }, (_, index) => from + index);

      addTag(range(1, 49), tag('acc-49', '49%'));
      addTag(range(101, 51), tag('acc-49', '49%'));
      addTag(range(50, 50), tag('acc-50', '50%'));
      addTag(range(101, 50), tag('acc-50', '50%'));
      addTag(range(1, 69), tag('acc-69', '69%'));
      addTag(range(101, 31), tag('acc-69', '69%'));
      addTag(range(1, 70), tag('acc-70', '70%'));
      addTag(range(101, 30), tag('acc-70', '70%'));

      const result = scoreExamAttempt(
        makeInput(payload, answers, {
          tagsByQuestionId: [...tagMap.entries()],
        }),
      );

      expect(result.weakAreas).toEqual([
        {
          slug: 'acc-49',
          name: '49%',
          answered: 100,
          correct: 49,
          accuracy: 0.49,
          level: 'weak',
        },
        {
          slug: 'acc-50',
          name: '50%',
          answered: 100,
          correct: 50,
          accuracy: 0.5,
          level: 'medium',
        },
        {
          slug: 'acc-69',
          name: '69%',
          answered: 100,
          correct: 69,
          accuracy: 0.69,
          level: 'medium',
        },
      ]);
    });

    it('returns at most five weak areas ordered by accuracy then slug', () => {
      const questionCount = 12;
      const questions: QuestionSpec[] = Array.from(
        { length: questionCount },
        (_, index) => ({
          key: `q${String(index + 1)}`,
          type: QuestionType.mcq,
          correctAnswer: { optionId: 'a' },
          questionId: index + 1,
        }),
      );
      const tagsByQuestionId: Array<[number, ExamScoringTag[]]> = [];
      for (let index = 0; index < 6; index += 1) {
        const slug = `tag-${String(index + 1)}`;
        tagsByQuestionId.push(
          [index * 2 + 1, [tag(slug)]],
          [index * 2 + 2, [tag(slug)]],
        );
      }
      const result = scoreExamAttempt(
        makeInput(
          makePayload([{ skill: Skill.reading, questions }]),
          questions.map((question) => [question.key, { choice: 'b' }]),
          { tagsByQuestionId },
        ),
      );

      expect(result.weakAreas).toHaveLength(5);
      expect(result.weakAreas.map((area) => area.slug)).toEqual([
        'tag-1',
        'tag-2',
        'tag-3',
        'tag-4',
        'tag-5',
      ]);
    });

    it('breaks an accuracy tie by code unit for slugs "b-x" and "bx" (A2 mandate)', () => {
      // Q154/A2: the persisted breakdown needs a deterministic tie-break, so a
      // hyphen-bearing slug pair must keep one stable order. On the current ICU
      // build `localeCompare` happens to return the same order for this pair;
      // the discriminating case below is the one that pins the implementation.
      const { payload, tagsByQuestionId } = tagPayload(4, [
        [1, [tag('bx')]],
        [2, [tag('bx')]],
        [3, [tag('b-x')]],
        [4, [tag('b-x')]],
      ]);

      const result = scoreExamAttempt(
        makeInput(
          payload,
          [
            ['q1', { choice: 'a' }],
            ['q2', { choice: 'b' }],
            ['q3', { choice: 'a' }],
            ['q4', { choice: 'b' }],
          ],
          { tagsByQuestionId },
        ),
      );

      expect(
        result.weakAreas.map((area) => ({
          slug: area.slug,
          accuracy: area.accuracy,
        })),
      ).toEqual([
        { slug: 'b-x', accuracy: 0.5 },
        { slug: 'bx', accuracy: 0.5 },
      ]);
    });

    it('breaks an accuracy tie by code unit, not by locale collation ("f" before "é")', () => {
      // `localeCompare('é', 'f')` is -1 (collation reads `é` as `e`), while the
      // raw code units put `f` (0x66) before `é` (0xE9). A Result row is
      // persisted, so the tie-break must not depend on the ICU/locale build.
      const { payload, tagsByQuestionId } = tagPayload(4, [
        [1, [tag('é')]],
        [2, [tag('é')]],
        [3, [tag('f')]],
        [4, [tag('f')]],
      ]);

      const result = scoreExamAttempt(
        makeInput(
          payload,
          [
            ['q1', { choice: 'a' }],
            ['q2', { choice: 'b' }],
            ['q3', { choice: 'a' }],
            ['q4', { choice: 'b' }],
          ],
          { tagsByQuestionId },
        ),
      );

      expect(
        result.weakAreas.map((area) => ({
          slug: area.slug,
          accuracy: area.accuracy,
        })),
      ).toEqual([
        { slug: 'f', accuracy: 0.5 },
        { slug: 'é', accuracy: 0.5 },
      ]);
    });

    it('freezes tag stats from the provided questionId → tag map', () => {
      const payload = makePayload([
        {
          skill: Skill.reading,
          questions: [
            {
              key: 'q1',
              type: QuestionType.mcq,
              correctAnswer: { optionId: 'a' },
              questionId: 42,
            },
            {
              key: 'q2',
              type: QuestionType.mcq,
              correctAnswer: { optionId: 'a' },
              questionId: 43,
            },
          ],
        },
      ]);

      const result = scoreExamAttempt(
        makeInput(
          payload,
          [
            ['q1', { choice: 'a' }],
            ['q2', { choice: 'b' }],
          ],
          {
            tagsByQuestionId: [
              [42, [tag('ngu-phap', 'Ngữ pháp')]],
              [43, [tag('ngu-phap', 'Ngữ pháp')]],
            ],
          },
        ),
      );

      expect(result.weakAreas).toEqual([
        {
          slug: 'ngu-phap',
          name: 'Ngữ pháp',
          answered: 2,
          correct: 1,
          accuracy: 0.5,
          level: 'medium',
        },
      ]);
    });
  });

  describe('input guards', () => {
    it('throws when a section has no questions', () => {
      const payload = makePayload([{ skill: Skill.reading, questions: [] }]);

      expect(() => scoreExamAttempt(makeInput(payload, []))).toThrow(
        ExamScoringError,
      );
    });

    it('throws when a question key repeats', () => {
      const payload = makePayload([
        {
          skill: Skill.reading,
          questions: [
            {
              key: 'q1',
              type: QuestionType.mcq,
              correctAnswer: { optionId: 'a' },
            },
            {
              key: 'q1',
              type: QuestionType.mcq,
              correctAnswer: { optionId: 'a' },
            },
          ],
        },
      ]);

      expect(() => scoreExamAttempt(makeInput(payload, []))).toThrow(
        ExamScoringError,
      );
    });
  });
});
