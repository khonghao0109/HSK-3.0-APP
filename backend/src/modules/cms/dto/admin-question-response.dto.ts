import { ApiProperty } from '@nestjs/swagger';
import {
  ContentReviewDecision,
  ContentStatus,
  Prisma,
  QuestionType,
  Skill,
} from '@prisma/client';

import { JSON_OBJECT_SCHEMA } from '../../../common/openapi/json-schemas';

// Response models of the M4.1a question bank endpoints (TL-82).

export class AdminQuestionLevelDto {
  id!: number;
  code!: string;
}

export class AdminQuestionTagDto {
  slug!: string;
  name!: string;
}

export class AdminQuestionLatestRevisionDto {
  id!: number;
  revision!: number;
  decision!: ContentReviewDecision | null;
}

export class AdminQuestionRevisionUserDto {
  id!: number;
  name!: string | null;
}

export class AdminQuestionRevisionReviewDto {
  decision!: ContentReviewDecision;
  note!: string | null;
  reviewer!: AdminQuestionRevisionUserDto | null;
  createdAt!: Date;
}

export class AdminQuestionRevisionDto {
  id!: number;
  revision!: number;
  contentHash!: string | null;
  createdAt!: Date;
  author!: AdminQuestionRevisionUserDto | null;
  /** Snapshot fields that differ from the previous revision; `[]` for v1. */
  changedFields!: string[];
  reviews!: AdminQuestionRevisionReviewDto[];
}

export class AdminQuestionBaseDto {
  id!: number;
  content!: string;
  type!: QuestionType;
  skill!: Skill;
  audioId!: number | null;
  imageId!: number | null;

  @ApiProperty(JSON_OBJECT_SCHEMA)
  answers!: Prisma.JsonValue;

  @ApiProperty(JSON_OBJECT_SCHEMA)
  correctAnswer!: Prisma.JsonValue;

  explanation!: string | null;
  objective!: string | null;
  levelId!: number;
  difficulty!: number | null;
  version!: number;
  contentHash!: string | null;
  status!: ContentStatus;
  dataSourceId!: number | null;
  createdById!: number | null;
  updatedById!: number | null;
  publishedById!: number | null;
  publishedAt!: Date | null;
  deletedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
  level!: AdminQuestionLevelDto;
  tags!: AdminQuestionTagDto[];
}

export class AdminQuestionDto extends AdminQuestionBaseDto {
  latestRevision!: AdminQuestionLatestRevisionDto | null;
}

export class AdminQuestionDetailDto extends AdminQuestionBaseDto {
  /** Newest first. */
  revisions!: AdminQuestionRevisionDto[];
}

export class AdminQuestionCountsBySkillDto {
  listening!: number;
  reading!: number;
  writing!: number;
  speaking!: number;
}

export class AdminQuestionCountsDto {
  total!: number;
  bySkill!: AdminQuestionCountsBySkillDto;
  /** Questions tagged `tu-vung` or `ngu-phap` (Q113). */
  vocabularyGrammar!: number;
}
