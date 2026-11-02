import { QuestionType, type Prisma, type Skill } from '@prisma/client';

import {
  EXAM_SECTION_MAX_SCORE,
  type ExamSnapshotPayload,
  type ExamSnapshotQuestion,
  type ExamSnapshotSection,
} from './exam-snapshot.builder';

/**
 * M4.3 / Q150: the scoring algorithm version is independent from
 * `Test.scoringVersion` (the authoring/config version frozen in the snapshot).
 * Bump it whenever normalization, rounding, pass/fail or weak-area rules change.
 */
export const EXAM_SCORING_VERSION = 'exam-score-v1';

/** Q154: a tag needs at least this many answered questions to be a weak area. */
export const EXAM_WEAK_AREA_MIN_ANSWERED = 2;
/** Q154: accuracy below 50% is "weak". */
export const EXAM_WEAK_AREA_LIMIT_PERCENT = 50;
/** Q154: accuracy below 70% is "medium" (and therefore still listed). */
export const EXAM_MEDIUM_AREA_LIMIT_PERCENT = 70;
/** Q154: the result keeps at most five weak areas. */
export const EXAM_WEAK_AREA_LIMIT = 5;

export type ExamScoringTag = {
  slug: string;
  name: string;
};

export type ExamScoringInput = {
  /** Frozen payload from `ExamAttemptSnapshot`, never the live Test tree. */
  payload: ExamSnapshotPayload;
  /** `snapshotQuestionKey` → stored learner answer; missing/null means blank. */
  answers: ReadonlyMap<string, Prisma.JsonValue | null | undefined>;
  /** Frozen tag view keyed by the question id stored in the snapshot. */
  tagsByQuestionId: ReadonlyMap<number, readonly ExamScoringTag[]>;
  /** `Test.passScore` frozen in the snapshot; null means "unknown". */
  passScore: number | null;
};

export type ExamScoringQuestion = {
  key: string;
  isCorrect: boolean;
};

export type ExamScoringSection = {
  key: string;
  orderIndex: number;
  title: string;
  skill: Skill;
  questionCount: number;
  correctCount: number;
  score: number;
  maxScore: number;
};

export type ExamScoringSkill = {
  skill: Skill;
  score: number;
  total: number;
};

export type ExamScoringWeakAreaLevel = 'weak' | 'medium';

export type ExamScoringWeakArea = {
  slug: string;
  name: string;
  answered: number;
  correct: number;
  accuracy: number;
  level: ExamScoringWeakAreaLevel;
};

export type ExamScoringCounts = {
  answeredCount: number;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
};

export type ExamScoringResult = {
  scoringVersion: typeof EXAM_SCORING_VERSION;
  score: number;
  maxScore: number;
  passed: boolean | null;
  sections: ExamScoringSection[];
  skills: ExamScoringSkill[];
  weakAreas: ExamScoringWeakArea[];
  questions: ExamScoringQuestion[];
  counts: ExamScoringCounts;
};

/**
 * Raised when the frozen payload or the stored answer has a shape the scorer
 * does not know. Grading fails closed instead of turning a data bug into a
 * wrong score.
 */
export class ExamScoringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExamScoringError';
  }
}

export function scoreExamAttempt(input: ExamScoringInput): ExamScoringResult {
  const seenKeys = new Set<string>();
  const questions: ExamScoringQuestion[] = [];
  const sections: ExamScoringSection[] = [];
  const skills = new Map<Skill, ExamScoringSkill>();
  const tagStats = new Map<
    string,
    { tag: ExamScoringTag; answered: number; correct: number }
  >();

  let score = 0;
  let answeredCount = 0;
  let correctCount = 0;

  for (const section of input.payload.sections) {
    const sectionQuestions = collectSectionQuestions(section);
    if (sectionQuestions.length === 0) {
      throw new ExamScoringError(
        `snapshot section "${section.key}" has no questions`,
      );
    }

    let sectionCorrectCount = 0;
    for (const question of sectionQuestions) {
      if (seenKeys.has(question.key)) {
        throw new ExamScoringError(
          `snapshot question key "${question.key}" is duplicated`,
        );
      }
      seenKeys.add(question.key);

      const answer = input.answers.get(question.key);
      const isCorrect = isBlank(answer)
        ? false
        : isCorrectQuestion(question, answer);
      const blank = isBlank(answer);

      questions.push({ key: question.key, isCorrect });
      if (!blank) {
        answeredCount += 1;
        recordTagStats(tagStats, input, question, isCorrect);
      }
      if (isCorrect) {
        sectionCorrectCount += 1;
        correctCount += 1;
      }
    }

    // Q143: round exactly once, at the section boundary, so
    // Σ sectionScore is an integer and the maximum stays 100 × sectionCount.
    const sectionScore = roundHalfUp(
      sectionCorrectCount,
      sectionQuestions.length,
    );
    score += sectionScore;
    sections.push({
      key: section.key,
      orderIndex: section.orderIndex,
      title: section.title,
      skill: section.skill,
      questionCount: sectionQuestions.length,
      correctCount: sectionCorrectCount,
      score: sectionScore,
      maxScore: EXAM_SECTION_MAX_SCORE,
    });

    // Q153: a skill's score is the sum of its sections' rounded scores.
    const skillScore = skills.get(section.skill) ?? {
      skill: section.skill,
      score: 0,
      total: 0,
    };
    skillScore.score += sectionScore;
    skillScore.total += EXAM_SECTION_MAX_SCORE;
    skills.set(section.skill, skillScore);
  }

  const maxScore = sections.length * EXAM_SECTION_MAX_SCORE;
  const weakAreas = buildWeakAreas(tagStats);

  return {
    scoringVersion: EXAM_SCORING_VERSION,
    score,
    maxScore,
    passed: input.passScore === null ? null : score >= input.passScore,
    sections,
    skills: [...skills.values()],
    weakAreas,
    questions,
    counts: {
      answeredCount,
      correctCount,
      incorrectCount: answeredCount - correctCount,
      unansweredCount: questions.length - answeredCount,
    },
  };
}

function collectSectionQuestions(
  section: ExamSnapshotSection,
): ExamSnapshotQuestion[] {
  return section.groups.flatMap((group) => group.questions);
}

function isBlank(
  answer: Prisma.JsonValue | null | undefined,
): answer is null | undefined {
  return answer === null || answer === undefined;
}

function isCorrectQuestion(
  question: ExamSnapshotQuestion,
  answer: Prisma.JsonValue,
): boolean {
  switch (question.type) {
    case QuestionType.mcq:
      return (
        readStringField(
          asRecord(answer, 'answer'),
          'choice',
          'answer.choice',
        ) ===
        readStringField(
          asRecord(question.correctAnswer, 'correctAnswer'),
          'optionId',
          'correctAnswer.optionId',
        )
      );
    case QuestionType.true_false:
      return (
        readBooleanField(answer, 'value', 'answer.value') ===
        readBooleanField(question.correctAnswer, 'value', 'correctAnswer.value')
      );
    case QuestionType.fill_blank: {
      const submitted = readStringField(
        asRecord(answer, 'answer'),
        'text',
        'answer.text',
      );
      const { acceptedTexts, caseSensitive } = readFillBlankAnswer(
        question.correctAnswer,
      );
      return acceptedTexts.some(
        (accepted) =>
          normalizeFillBlank(submitted, caseSensitive) ===
          normalizeFillBlank(accepted, caseSensitive),
      );
    }
    case QuestionType.arrange_sentence: {
      const submitted = readStringArray(answer, 'order', 'answer.order');
      const expected = readStringArray(
        question.correctAnswer,
        'tokenIds',
        'correctAnswer.tokenIds',
      );
      return (
        submitted.length === expected.length &&
        submitted.every((tokenId, index) => tokenId === expected[index])
      );
    }
    default:
      // Q141: writing/speaking and the legacy skill types have no objective
      // answer contract in M4.3, so a frozen one is a data bug.
      throw new ExamScoringError(
        `unsupported exam question type "${question.type}"`,
      );
  }
}

function readBooleanField(
  value: Prisma.JsonValue,
  key: string,
  field: string,
): boolean {
  const record = asRecord(value, field);
  const result = record[key];
  if (typeof result !== 'boolean') {
    throw new ExamScoringError(`${field} must be a boolean`);
  }
  return result;
}

function readStringArray(
  value: Prisma.JsonValue,
  key: string,
  field: string,
): string[] {
  const record = asRecord(value, field);
  const raw = record[key];
  if (!Array.isArray(raw)) {
    throw new ExamScoringError(`${field} must be an array`);
  }
  return raw.map((item, index) => {
    if (typeof item !== 'string') {
      throw new ExamScoringError(`${field}[${String(index)}] must be a string`);
    }
    return item;
  });
}

function readFillBlankAnswer(value: Prisma.JsonValue): {
  acceptedTexts: string[];
  caseSensitive: boolean;
} {
  const record = asRecord(value, 'correctAnswer');
  const acceptedTexts = readStringArray(
    record,
    'acceptedTexts',
    'correctAnswer.acceptedTexts',
  );
  if (acceptedTexts.length === 0) {
    throw new ExamScoringError('correctAnswer.acceptedTexts must not be empty');
  }
  const caseSensitive = record.caseSensitive;
  if (caseSensitive !== undefined && typeof caseSensitive !== 'boolean') {
    throw new ExamScoringError('correctAnswer.caseSensitive must be a boolean');
  }
  return { acceptedTexts, caseSensitive: caseSensitive === true };
}

function readStringField(
  record: Prisma.JsonObject,
  key: string,
  field: string,
): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new ExamScoringError(`${field} must be a string`);
  }
  return value;
}

function asRecord(value: Prisma.JsonValue, field: string): Prisma.JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExamScoringError(`${field} must be an object`);
  }
  return value;
}

function normalizeFillBlank(value: string, caseSensitive: boolean): string {
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  return caseSensitive ? normalized : normalized.toLowerCase();
}

/**
 * Q143: integer half-up rounding; float division turns 23/40 into
 * 0.574999… and would lose the .5 boundary.
 */
function roundHalfUp(correct: number, count: number): number {
  return Math.floor(
    (2 * EXAM_SECTION_MAX_SCORE * correct + count) / (2 * count),
  );
}

function recordTagStats(
  stats: Map<
    string,
    { tag: ExamScoringTag; answered: number; correct: number }
  >,
  input: ExamScoringInput,
  question: ExamSnapshotQuestion,
  isCorrect: boolean,
): void {
  const tags = input.tagsByQuestionId.get(question.questionId) ?? [];
  const uniqueTags = new Map<string, ExamScoringTag>();
  for (const tag of tags) {
    if (!uniqueTags.has(tag.slug)) uniqueTags.set(tag.slug, tag);
  }
  for (const tag of uniqueTags.values()) {
    const current = stats.get(tag.slug) ?? {
      tag,
      answered: 0,
      correct: 0,
    };
    current.answered += 1;
    if (isCorrect) current.correct += 1;
    stats.set(tag.slug, current);
  }
}

function buildWeakAreas(
  stats: Map<
    string,
    { tag: ExamScoringTag; answered: number; correct: number }
  >,
): ExamScoringWeakArea[] {
  const areas: ExamScoringWeakArea[] = [];
  for (const { tag, answered, correct } of stats.values()) {
    if (answered < EXAM_WEAK_AREA_MIN_ANSWERED) continue;
    const level = weakAreaLevel(correct, answered);
    if (level === null) continue;
    areas.push({
      slug: tag.slug,
      name: tag.name,
      answered,
      correct,
      accuracy: correct / answered,
      level,
    });
  }
  return areas
    .sort(
      (left, right) =>
        left.accuracy - right.accuracy ||
        compareCodeUnits(left.slug, right.slug),
    )
    .slice(0, EXAM_WEAK_AREA_LIMIT);
}

/**
 * Q154: the breakdown is persisted, so the tie-break must not depend on the
 * runtime locale or on an ICU build; raw code-unit order is deterministic.
 */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function weakAreaLevel(
  correct: number,
  answered: number,
): ExamScoringWeakAreaLevel | null {
  if (correct * 100 < answered * EXAM_WEAK_AREA_LIMIT_PERCENT) return 'weak';
  if (correct * 100 < answered * EXAM_MEDIUM_AREA_LIMIT_PERCENT) {
    return 'medium';
  }
  return null;
}
