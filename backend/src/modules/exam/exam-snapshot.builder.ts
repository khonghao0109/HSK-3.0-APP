import {
  MediaType,
  type Prisma,
  type QuestionType,
  type Skill,
} from '@prisma/client';

import { sha256CanonicalJson } from '../../common/utils/canonical-json';
import type { CmsMediaRecord } from '../cms/media-usability';

/**
 * TL-113 / Q121: the immutable exam snapshot. The payload is written once, in
 * the same transaction that creates the attempt, and it is the only source for
 * rendering the exam and for grading afterwards — editing a Question later
 * (Q116) cannot change an attempt that already started.
 */
export const EXAM_SNAPSHOT_SCHEMA_VERSION = 1;

/** 100 points per section, so maxScore = 100 × sectionCount (Q118). */
export const EXAM_SECTION_MAX_SCORE = 100;

export type ExamSnapshotMedia = {
  mediaId: number;
  kind: MediaType;
  mimeType: string | null;
  durationMs: number | null;
};

export type ExamSnapshotQuestion = {
  key: string;
  orderIndex: number;
  questionId: number;
  questionVersion: number;
  type: QuestionType;
  skill: Skill;
  content: string;
  answers: Prisma.JsonValue;
  audio: ExamSnapshotMedia | null;
  image: ExamSnapshotMedia | null;
  correctAnswer: Prisma.JsonValue;
  explanation: string | null;
};

export type ExamSnapshotGroup = {
  key: string;
  orderIndex: number;
  title: string | null;
  instruction: string | null;
  content: Prisma.JsonValue | null;
  audio: ExamSnapshotMedia | null;
  image: ExamSnapshotMedia | null;
  questions: ExamSnapshotQuestion[];
};

export type ExamSnapshotSection = {
  key: string;
  orderIndex: number;
  skill: Skill;
  title: string;
  instruction: string | null;
  maxScore: number;
  groups: ExamSnapshotGroup[];
};

export type ExamSnapshotTest = {
  id: number;
  title: string;
  instruction: string | null;
  levelCode: string;
  durationMinutes: number;
  passScore: number | null;
  maxScore: number;
  scoringVersion: string;
};

export type ExamSnapshotPayload = {
  schemaVersion: number;
  test: ExamSnapshotTest;
  sections: ExamSnapshotSection[];
};

/** One question as read from the locked tree, before it is keyed by placement. */
export type ExamSnapshotSourceQuestion = {
  placementOrderIndex: number;
  question: {
    id: number;
    version: number;
    type: QuestionType;
    skill: Skill;
    content: string;
    answers: Prisma.JsonValue;
    correctAnswer: Prisma.JsonValue;
    explanation: string | null;
    audio: ExamSnapshotMedia | null;
    image: ExamSnapshotMedia | null;
  };
};

export type ExamSnapshotSourceGroup = {
  orderIndex: number;
  title: string | null;
  instruction: string | null;
  content: Prisma.JsonValue | null;
  audio: ExamSnapshotMedia | null;
  image: ExamSnapshotMedia | null;
  questions: ExamSnapshotSourceQuestion[];
};

export type ExamSnapshotSourceSection = {
  orderIndex: number;
  skill: Skill;
  title: string;
  instruction: string | null;
  groups: ExamSnapshotSourceGroup[];
};

export type ExamSnapshotSource = {
  test: {
    id: number;
    title: string;
    instruction: string | null;
    levelCode: string;
    /** Whole-test duration in minutes (Q118). */
    duration: number;
    passScore: number | null;
    /** Live value; the builder recomputes it from the frozen structure. */
    maxScore: number;
    scoringVersion: string;
    version: number;
  };
  sections: ExamSnapshotSourceSection[];
};

export type BuiltExamSnapshot = {
  payload: ExamSnapshotPayload;
  contentHash: string;
  testVersion: number;
  snapshotVersion: number;
};

/**
 * The snapshot keeps only the media fields a learner player needs; storage
 * keys, checksums and provenance stay out of the payload.
 */
export function projectExamSnapshotMedia(
  media: CmsMediaRecord | null,
): ExamSnapshotMedia | null {
  if (media === null) return null;
  return {
    mediaId: media.id,
    kind: media.type,
    mimeType: media.mimeType,
    durationMs: media.duration,
  };
}

/**
 * `key` values are the identity used by `ExamAnswer.snapshotQuestionKey` in
 * M4.2b: `s<order>`, `s<order>-g<order>` and `q<placement order>`.
 */
export function buildExamSnapshot(
  source: ExamSnapshotSource,
): BuiltExamSnapshot {
  const maxScore = EXAM_SECTION_MAX_SCORE * source.sections.length;
  const payload: ExamSnapshotPayload = {
    schemaVersion: EXAM_SNAPSHOT_SCHEMA_VERSION,
    test: {
      id: source.test.id,
      title: source.test.title,
      instruction: source.test.instruction,
      levelCode: source.test.levelCode,
      durationMinutes: source.test.duration,
      passScore: source.test.passScore,
      maxScore,
      scoringVersion: source.test.scoringVersion,
    },
    sections: source.sections.map((section) => ({
      key: `s${String(section.orderIndex)}`,
      orderIndex: section.orderIndex,
      skill: section.skill,
      title: section.title,
      instruction: section.instruction,
      maxScore: EXAM_SECTION_MAX_SCORE,
      groups: section.groups.map((group) => ({
        key: `s${String(section.orderIndex)}-g${String(group.orderIndex)}`,
        orderIndex: group.orderIndex,
        title: group.title,
        instruction: group.instruction,
        content: group.content,
        audio: group.audio,
        image: group.image,
        questions: group.questions.map((entry) => ({
          key: `q${String(entry.placementOrderIndex)}`,
          orderIndex: entry.placementOrderIndex,
          questionId: entry.question.id,
          questionVersion: entry.question.version,
          type: entry.question.type,
          skill: entry.question.skill,
          content: entry.question.content,
          // shortcut: `arrange_sentence` tokens are stored in the shuffled
          // order the authoring form produced (M4.1a), so the snapshot keeps
          // the stored order verbatim — re-sorting here would hand the learner
          // the correct sentence.
          answers: entry.question.answers,
          audio: entry.question.audio,
          image: entry.question.image,
          correctAnswer: entry.question.correctAnswer,
          explanation: entry.question.explanation,
        })),
      })),
    })),
  };

  return {
    payload,
    contentHash: sha256CanonicalJson(payload),
    testVersion: source.test.version,
    snapshotVersion: EXAM_SNAPSHOT_SCHEMA_VERSION,
  };
}
