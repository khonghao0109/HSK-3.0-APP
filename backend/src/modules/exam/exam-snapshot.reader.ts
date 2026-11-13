import { InternalServerErrorException } from '@nestjs/common';
import { MediaType, QuestionType, Skill, type Prisma } from '@prisma/client';

import {
  EXAM_SNAPSHOT_SCHEMA_VERSION,
  type ExamSnapshotGroup,
  type ExamSnapshotMedia,
  type ExamSnapshotPayload,
  type ExamSnapshotQuestion,
  type ExamSnapshotSection,
} from './exam-snapshot.builder';

const QUESTION_TYPES = Object.values(QuestionType);
const SKILLS = Object.values(Skill);
const MEDIA_KINDS = Object.values(MediaType);

/**
 * Reads the frozen `ExamAttemptSnapshot.payload` back with an explicit
 * projection: only the documented v1 fields are copied, so the stored JSON
 * cannot add a key to a learner response. The payload is written by
 * `buildExamSnapshot` and the table is immutable by trigger, so an invalid
 * payload is a server fault rather than a client error.
 */
export function readExamSnapshotPayload(
  value: Prisma.JsonValue,
): ExamSnapshotPayload {
  const root = recordOf(value);
  if (!root) throw invalidSnapshot();

  const version = numberOf(root.schemaVersion);
  if (version !== EXAM_SNAPSHOT_SCHEMA_VERSION) {
    throw invalidSnapshot();
  }
  const test = recordOf(root.test);
  if (!test) throw invalidSnapshot();

  return {
    schemaVersion: EXAM_SNAPSHOT_SCHEMA_VERSION,
    test: {
      id: requiredNumber(test.id, 'test.id'),
      title: requiredText(test.title, 'test.title'),
      instruction: nullableText(test.instruction, 'test.instruction'),
      levelCode: requiredText(test.levelCode, 'test.levelCode'),
      durationMinutes: requiredNumber(
        test.durationMinutes,
        'test.durationMinutes',
      ),
      passScore:
        test.passScore === null || test.passScore === undefined
          ? null
          : requiredNumber(test.passScore, 'test.passScore'),
      maxScore: requiredNumber(test.maxScore, 'test.maxScore'),
      scoringVersion: requiredText(test.scoringVersion, 'test.scoringVersion'),
    },
    sections: arrayOf(root.sections).map((rawSection, sectionIndex) =>
      readSection(rawSection, `sections[${String(sectionIndex)}]`),
    ),
  };
}

function readSection(
  value: Prisma.JsonValue,
  path: string,
): ExamSnapshotSection {
  const record = recordOf(value);
  if (!record) throw invalidSnapshot();
  return {
    key: requiredText(record.key, `${path}.key`),
    orderIndex: requiredNumber(record.orderIndex, `${path}.orderIndex`),
    skill: requiredEnum(record.skill, SKILLS, `${path}.skill`),
    title: requiredText(record.title, `${path}.title`),
    instruction: nullableText(record.instruction, `${path}.instruction`),
    maxScore: requiredNumber(record.maxScore, `${path}.maxScore`),
    groups: arrayOf(record.groups).map((rawGroup, groupIndex) =>
      readGroup(rawGroup, `${path}.groups[${String(groupIndex)}]`),
    ),
  };
}

function readGroup(value: Prisma.JsonValue, path: string): ExamSnapshotGroup {
  const record = recordOf(value);
  if (!record) throw invalidSnapshot();
  return {
    key: requiredText(record.key, `${path}.key`),
    orderIndex: requiredNumber(record.orderIndex, `${path}.orderIndex`),
    title: nullableText(record.title, `${path}.title`),
    instruction: nullableText(record.instruction, `${path}.instruction`),
    content:
      record.content === null || record.content === undefined
        ? null
        : record.content,
    audio: readMedia(record.audio, `${path}.audio`),
    image: readMedia(record.image, `${path}.image`),
    questions: arrayOf(record.questions).map((rawQuestion, questionIndex) =>
      readQuestion(rawQuestion, `${path}.questions[${String(questionIndex)}]`),
    ),
  };
}

function readQuestion(
  value: Prisma.JsonValue,
  path: string,
): ExamSnapshotQuestion {
  const record = recordOf(value);
  if (!record) throw invalidSnapshot();
  const answers = record.answers;
  const correctAnswer = record.correctAnswer;
  if (answers === undefined || correctAnswer === undefined) {
    throw invalidSnapshot();
  }
  return {
    key: requiredText(record.key, `${path}.key`),
    orderIndex: requiredNumber(record.orderIndex, `${path}.orderIndex`),
    questionId: requiredNumber(record.questionId, `${path}.questionId`),
    questionVersion: requiredNumber(
      record.questionVersion,
      `${path}.questionVersion`,
    ),
    type: requiredEnum(record.type, QUESTION_TYPES, `${path}.type`),
    skill: requiredEnum(record.skill, SKILLS, `${path}.skill`),
    content: requiredText(record.content, `${path}.content`),
    answers,
    audio: readMedia(record.audio, `${path}.audio`),
    image: readMedia(record.image, `${path}.image`),
    correctAnswer,
    explanation: nullableText(record.explanation, `${path}.explanation`),
  };
}

function readMedia(
  value: Prisma.JsonValue | undefined,
  path: string,
): ExamSnapshotMedia | null {
  if (value === null || value === undefined) return null;
  const record = recordOf(value);
  if (!record) throw invalidSnapshot();
  return {
    mediaId: requiredNumber(record.mediaId, `${path}.mediaId`),
    kind: requiredEnum(record.kind, MEDIA_KINDS, `${path}.kind`),
    mimeType: nullableText(record.mimeType, `${path}.mimeType`),
    durationMs:
      record.durationMs === null || record.durationMs === undefined
        ? null
        : requiredNumber(record.durationMs, `${path}.durationMs`),
  };
}

function recordOf(value: unknown): Prisma.JsonObject | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value;
}

function arrayOf(value: Prisma.JsonValue | undefined): Prisma.JsonValue[] {
  if (!Array.isArray(value)) throw invalidSnapshot();
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
  if (parsed === null) throw invalidSnapshot(field);
  return parsed;
}

function requiredText(
  value: Prisma.JsonValue | undefined,
  field: string,
): string {
  if (typeof value !== 'string') throw invalidSnapshot(field);
  return value;
}

function nullableText(
  value: Prisma.JsonValue | undefined,
  field: string,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw invalidSnapshot(field);
  return value;
}

function requiredEnum<T extends string>(
  value: Prisma.JsonValue | undefined,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== 'string') throw invalidSnapshot(field);
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) throw invalidSnapshot(field);
  return match;
}

function invalidSnapshot(field?: string): InternalServerErrorException {
  return new InternalServerErrorException(
    field === undefined
      ? 'Exam snapshot payload is invalid.'
      : `Exam snapshot payload field "${field}" is invalid.`,
  );
}
