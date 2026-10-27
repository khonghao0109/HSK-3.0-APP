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
