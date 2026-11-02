import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ExamAttemptStatus,
  MediaType,
  Prisma,
  QuestionType,
  Skill,
} from '@prisma/client';

import { JSON_OBJECT_SCHEMA } from '../../../common/openapi/json-schemas';

// Response models of the M4.2a learner exam endpoints (TL-110/TL-114).
// Every field below is the allow-listed projection of `exam.serializer.ts`;
// internal scoring fields (correctAnswer, explanation, …) never appear here.

/** The `media` shape inside a frozen snapshot and its learner projection. */
export class ExamSnapshotMediaDto {
  mediaId!: number;
  kind!: MediaType;
  mimeType!: string | null;
  durationMs!: number | null;
}

export class ExamQuestionOptionDto {
  id!: string;
  text!: string;
}

/** Renderable answer payload per question type: options, tokens or `{}`. */
export class ExamQuestionAnswersDto {
  @ApiPropertyOptional({ type: [ExamQuestionOptionDto] })
  options?: ExamQuestionOptionDto[];

  @ApiPropertyOptional({ type: [ExamQuestionOptionDto] })
  tokens?: ExamQuestionOptionDto[];
}

export class ExamAttemptQuestionDto {
  /** Snapshot question key; `ExamAnswer.snapshotQuestionKey` from M4.2b. */
  key!: string;
  orderIndex!: number;
  type!: QuestionType;
  skill!: Skill;
  content!: string;
  answers!: ExamQuestionAnswersDto;
  audio!: ExamSnapshotMediaDto | null;
  image!: ExamSnapshotMediaDto | null;
}

export class ExamAttemptGroupDto {
  key!: string;
  orderIndex!: number;
  title!: string | null;
  instruction!: string | null;

  @ApiProperty(JSON_OBJECT_SCHEMA)
  content!: Prisma.JsonValue | null;

  audio!: ExamSnapshotMediaDto | null;
  image!: ExamSnapshotMediaDto | null;
  questions!: ExamAttemptQuestionDto[];
}

export class ExamAttemptSectionDto {
  key!: string;
  orderIndex!: number;
  title!: string;
  instruction!: string | null;
  skill!: Skill;
  groups!: ExamAttemptGroupDto[];
}

/** Test summary read from the frozen snapshot, not from the live row. */
export class ExamAttemptTestDto {
  title!: string;
  instruction!: string | null;
  levelCode!: string;
  durationMinutes!: number;
  passScore!: number | null;
}

export class ExamAnswerViewDto {
  /** Snapshot question key the answer belongs to (`q<orderIndex>`). */
  questionKey!: string;

  @ApiProperty(JSON_OBJECT_SCHEMA)
  answer!: Prisma.JsonValue | null;

  isFlagged!: boolean;
  version!: number;
  /** Last time a non-null answer was stored; kept when the answer is cleared. */
  answeredAt!: Date | null;
  lastSavedAt!: Date;
}

/** TL-121: the 200 body of `PUT .../answers/:questionKey`. */
export class ExamAnswerSaveViewDto {
  questionKey!: string;

  @ApiProperty(JSON_OBJECT_SCHEMA)
  answer!: Prisma.JsonValue | null;

  isFlagged!: boolean;
  version!: number;
  answeredAt!: Date | null;
  lastSavedAt!: Date;
  /** Server clock at response time; the client never trusts its own clock. */
  serverNow!: Date;
  remainingSeconds!: number;
}

export const EXAM_ANSWER_BATCH_STATUSES = [
  'saved',
  'replayed',
  'conflict',
  'invalid',
  'not_found',
] as const;

export type ExamAnswerBatchStatus = (typeof EXAM_ANSWER_BATCH_STATUSES)[number];

/** One item result of the batch save; errors are per item, never the batch. */
export class ExamAnswerBatchResultDto {
  questionKey!: string;
  status!: ExamAnswerBatchStatus;
  answer?: ExamAnswerViewDto;
  /** Machine code for `invalid` items (`EXAM_ANSWER_INVALID`). */
  code?: string;
  /** Current row for `conflict` items; `null` when the question has no row. */
  current?: ExamAnswerViewDto | null;
}

/** TL-124: the 200 body of `PUT .../answers` (batch). */
export class ExamAnswerBatchViewDto {
  results!: ExamAnswerBatchResultDto[];
  serverNow!: Date;
  remainingSeconds!: number;
}

/**
 * TL-128: one signed media grant. `url` is the exact shape of
 * `GET /media/:id/access` so the existing content route and learner BFF
 * handler can be reused.
 */
export class ExamMediaGrantItemDto {
  mediaId!: number;
  kind!: MediaType;
  url!: string;
  expiresAt!: string;
}

export class ExamMediaGrantsDto {
  grants!: ExamMediaGrantItemDto[];
  /** Snapshot media ids that are no longer available; nothing is signed. */
  unavailable!: number[];
}

/** `ExamAttemptView` — the body of POST attempts and GET attempt. */
export class ExamAttemptViewDto {
  id!: number;
  testId!: number;
  status!: ExamAttemptStatus;
  startedAt!: Date;
  expiresAt!: Date;
  /** Server clock at response time; the client never trusts its own clock. */
  serverNow!: Date;
  remainingSeconds!: number;
  maxScore!: number;
  questionCount!: number;
  test!: ExamAttemptTestDto;
  sections!: ExamAttemptSectionDto[];
  answers!: ExamAnswerViewDto[];
}

export class ExamTestIntroSectionDto {
  orderIndex!: number;
  title!: string;
  skill!: Skill;
  questionCount!: number;
  /** 100 per section (Q118). */
  maxScore!: number;
}

export class ExamTestActiveAttemptDto {
  id!: number;
  startedAt!: Date;
  expiresAt!: Date;
  answeredCount!: number;
  questionCount!: number;
}

/** `ExamTestIntro` — the body of GET /exam/tests/:testId. */
export class ExamTestIntroDto {
  id!: number;
  title!: string;
  instruction!: string | null;
  levelCode!: string;
  durationMinutes!: number;
  questionCount!: number;
  sectionCount!: number;
  /** 100 × sectionCount (Q118). */
  maxScore!: number;
  passScore!: number | null;
  sections!: ExamTestIntroSectionDto[];
  /** Only an in-progress attempt that has not expired (Q120/TL-112). */
  activeAttempt!: ExamTestActiveAttemptDto | null;
}

/**
 * TL-150: the 200 body of `POST /exam/attempts/:attemptId/submit`. Counts are
 * aggregate numbers only; no answer content, score or result is returned.
 */
export class ExamSubmitViewDto {
  id!: number;
  status!: ExamAttemptStatus;
  submittedAt!: Date;
  /** Server clock at response time; the client never trusts its own clock. */
  serverNow!: Date;
  answeredCount!: number;
  unansweredCount!: number;
  flaggedCount!: number;
  /** True when this request replayed a previously committed submit key. */
  replayed!: boolean;
}

/**
 * TL-165: aggregate counts read back from `Result.detailJson` (schemaVersion 1).
 * They are the persisted grading output, not a fresh count of `ExamAnswer`.
 */
export class ExamResultCountsDto {
  answeredCount!: number;
  correctCount!: number;
  incorrectCount!: number;
  unansweredCount!: number;
}

/** One graded section; `title` comes from the frozen snapshot (Q151). */
export class ExamResultSectionDto {
  key!: string;
  title!: string;
  skill!: Skill;
  questionCount!: number;
  correctCount!: number;
  score!: number;
  maxScore!: number;
}

/** One skill total (Q153: the sum of its rounded section scores). */
export class ExamResultSkillDto {
  skill!: Skill;
  score!: number;
  maxScore!: number;
}

/** Q154: a tag with at least two answered questions and accuracy below 70%. */
export class ExamResultWeakAreaDto {
  slug!: string;
  name!: string;
  answered!: number;
  correct!: number;
  accuracy!: number;
  @ApiProperty({ enum: ['weak', 'medium'] })
  level!: 'weak' | 'medium';
}

/**
 * `ExamResultView` — the 200 body of `GET /exam/attempts/:attemptId/result`
 * (TL-165/Q151). It is built from the stored `Result` row and the frozen
 * snapshot; it never re-grades and never carries an answer key.
 */
export class ExamResultViewDto {
  attemptId!: number;
  /** Terminal states only: result is never served for in_progress/invalidated. */
  @ApiProperty({ enum: ['submitted', 'timed_out'] })
  status!: 'submitted' | 'timed_out';
  /** Test title frozen in the attempt snapshot, not the live `Test.title`. */
  testTitle!: string;
  startedAt!: Date;
  submittedAt!: Date;
  score!: number;
  maxScore!: number;
  /** `Test.passScore` frozen in the snapshot; null means "not set". */
  passScore!: number | null;
  /** null when the frozen passScore is null (Q145). */
  passed!: boolean | null;
  scoringVersion!: string;
  /** `Result.publishedAt` — the moment the lazy/atomic grading ran. */
  gradedAt!: Date;
  counts!: ExamResultCountsDto;
  sections!: ExamResultSectionDto[];
  skills!: ExamResultSkillDto[];
  weakAreas!: ExamResultWeakAreaDto[];
}

/**
 * TL-166/Q148: one question of the post-terminal review. The answer key and
 * the explanation come from the frozen snapshot, never from the live row, and
 * `isCorrect` comes from `Result.detailJson` (one source of truth). Q158: media
 * stays `null` in M4.3; signed grants for review arrive in M4.5.
 */
export class ExamReviewQuestionDto {
  /** Snapshot question key (`q<placement order>`), same as the attempt view. */
  key!: string;
  orderIndex!: number;
  type!: QuestionType;
  skill!: Skill;
  content!: string;
  answers!: ExamQuestionAnswersDto;

  @ApiProperty(JSON_OBJECT_SCHEMA)
  learnerAnswer!: Prisma.JsonValue | null;

  @ApiProperty(JSON_OBJECT_SCHEMA)
  correctAnswer!: Prisma.JsonValue;

  explanation!: string | null;
  isCorrect!: boolean;
  audio!: ExamSnapshotMediaDto | null;
  image!: ExamSnapshotMediaDto | null;
}

/**
 * `ExamReviewView` — the 200 body of `GET /exam/attempts/:attemptId/review`
 * (TL-166/Q149). Questions are the frozen snapshot order (section → group →
 * question) and the list is never paginated (Q151 caps a test at 200).
 */
export class ExamReviewViewDto {
  attemptId!: number;
  /** Terminal states only: review is never served for in_progress/invalidated. */
  @ApiProperty({ enum: ['submitted', 'timed_out'] })
  status!: 'submitted' | 'timed_out';
  testTitle!: string;
  startedAt!: Date;
  submittedAt!: Date;
  questions!: ExamReviewQuestionDto[];
}
