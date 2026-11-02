import { InternalServerErrorException } from '@nestjs/common';
import { Skill, type Prisma } from '@prisma/client';

import type {
  ExamScoringCounts,
  ExamScoringQuestion,
  ExamScoringSection,
  ExamScoringWeakArea,
  ExamScoringWeakAreaLevel,
} from './exam-scoring';

/**
 * M4.3 / TL-165: `Result.detailJson` is the persisted grading breakdown
 * (`schemaVersion: 1`, written by `ensureAttemptResult`). The result and review
 * endpoints read it back instead of grading again (Q147), so it is parsed with
 * an explicit allow-list projection: only the documented v1 fields are copied
 * and an unknown shape fails closed with a server fault. The stored JSON is
 * written by this server and the row is never edited, so an invalid payload is
 * a data bug rather than a client error.
 *
 * The client-visible message is fixed (it never names the broken field or the
 * stored value); the field path is carried on the error object so the service
 * can log it server-side without echoing answer-derived content.
 */
export const EXAM_RESULT_DETAIL_SCHEMA_VERSION = 1;

export const EXAM_RESULT_UNAVAILABLE_MESSAGE = 'Exam result is unavailable.';

export class ExamResultDetailError extends InternalServerErrorException {
  constructor(readonly field?: string) {
    super(EXAM_RESULT_UNAVAILABLE_MESSAGE);
    this.name = 'ExamResultDetailError';
  }
}

export type ExamResultDetail = {
  schemaVersion: typeof EXAM_RESULT_DETAIL_SCHEMA_VERSION;
  attemptScoringVersion: string;
  snapshotContentHash: string;
  counts: ExamScoringCounts;
  sections: Array<Omit<ExamScoringSection, 'orderIndex' | 'title'>>;
  weakAreas: ExamScoringWeakArea[];
  questions: ExamScoringQuestion[];
};

const SKILLS = Object.values(Skill);
const WEAK_AREA_LEVELS: readonly ExamScoringWeakAreaLevel[] = [
  'weak',
  'medium',
];

/**
 * Q153: the persisted detail carries the per-section and per-question grading
 * only. Skill totals live in `ResultSkillScore` rows, so callers read those
 * separately; this reader validates exactly the documented v1 keys.
 */
export function readExamResultDetail(
  value: Prisma.JsonValue,
): ExamResultDetail {
  const root = recordOf(value);
  if (!root) throw invalidDetail();
  if (numberOf(root.schemaVersion) !== EXAM_RESULT_DETAIL_SCHEMA_VERSION) {
    throw invalidDetail();
  }

  const counts = recordOf(root.counts);
  if (!counts) throw invalidDetail('counts');

  const questions = arrayOf(root.questions, 'questions').map(
    (rawQuestion, index) =>
      readQuestion(rawQuestion, `questions[${String(index)}]`),
  );
  const seenKeys = new Set<string>();
  for (const question of questions) {
    if (seenKeys.has(question.key)) throw invalidDetail('questions');
    seenKeys.add(question.key);
  }

  return {
    schemaVersion: EXAM_RESULT_DETAIL_SCHEMA_VERSION,
    attemptScoringVersion: requiredText(
      root.attemptScoringVersion,
      'attemptScoringVersion',
    ),
    snapshotContentHash: requiredText(
      root.snapshotContentHash,
      'snapshotContentHash',
    ),
    counts: {
      answeredCount: requiredNumber(
        counts.answeredCount,
        'counts.answeredCount',
      ),
      correctCount: requiredNumber(counts.correctCount, 'counts.correctCount'),
      incorrectCount: requiredNumber(
        counts.incorrectCount,
        'counts.incorrectCount',
      ),
      unansweredCount: requiredNumber(
        counts.unansweredCount,
        'counts.unansweredCount',
      ),
    },
    sections: arrayOf(root.sections, 'sections').map((rawSection, index) =>
      readSection(rawSection, `sections[${String(index)}]`),
    ),
    weakAreas: arrayOf(root.weakAreas, 'weakAreas').map((rawArea, index) =>
      readWeakArea(rawArea, `weakAreas[${String(index)}]`),
    ),
    questions,
  };
}

function readSection(
  value: Prisma.JsonValue,
  path: string,
): ExamResultDetail['sections'][number] {
  const record = recordOf(value);
  if (!record) throw invalidDetail(path);
  return {
    key: requiredText(record.key, `${path}.key`),
    skill: requiredEnum(record.skill, SKILLS, `${path}.skill`),
    questionCount: requiredNumber(
      record.questionCount,
      `${path}.questionCount`,
    ),
    correctCount: requiredNumber(record.correctCount, `${path}.correctCount`),
    score: requiredNumber(record.score, `${path}.score`),
    maxScore: requiredNumber(record.maxScore, `${path}.maxScore`),
  };
}

function readWeakArea(
  value: Prisma.JsonValue,
  path: string,
): ExamScoringWeakArea {
  const record = recordOf(value);
  if (!record) throw invalidDetail(path);
  return {
    slug: requiredText(record.slug, `${path}.slug`),
    name: requiredText(record.name, `${path}.name`),
    answered: requiredNumber(record.answered, `${path}.answered`),
    correct: requiredNumber(record.correct, `${path}.correct`),
    accuracy: requiredNumber(record.accuracy, `${path}.accuracy`),
    level: requiredEnum(record.level, WEAK_AREA_LEVELS, `${path}.level`),
  };
}

function readQuestion(
  value: Prisma.JsonValue,
  path: string,
): ExamScoringQuestion {
  const record = recordOf(value);
  if (!record) throw invalidDetail(path);
  return {
    key: requiredText(record.key, `${path}.key`),
    isCorrect: requiredBoolean(record.isCorrect, `${path}.isCorrect`),
  };
}

function recordOf(value: unknown): Prisma.JsonObject | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value;
}

function arrayOf(
  value: Prisma.JsonValue | undefined,
  field: string,
): Prisma.JsonValue[] {
  if (!Array.isArray(value)) throw invalidDetail(field);
  return value;
}

function numberOf(value: Prisma.JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function requiredNumber(
  value: Prisma.JsonValue | undefined,
  field: string,
): number {
  const parsed = numberOf(value);
  if (parsed === null) throw invalidDetail(field);
  return parsed;
}

function requiredBoolean(
  value: Prisma.JsonValue | undefined,
  field: string,
): boolean {
  if (typeof value !== 'boolean') throw invalidDetail(field);
  return value;
}

function requiredText(
  value: Prisma.JsonValue | undefined,
  field: string,
): string {
  if (typeof value !== 'string') throw invalidDetail(field);
  return value;
}

function requiredEnum<T extends string>(
  value: Prisma.JsonValue | undefined,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== 'string') throw invalidDetail(field);
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) throw invalidDetail(field);
  return match;
}

/** Fixed client text + a field path for the server log only. */
function invalidDetail(field?: string): ExamResultDetailError {
  return new ExamResultDetailError(field);
}
