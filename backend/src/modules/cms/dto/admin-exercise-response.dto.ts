import { ApiProperty } from '@nestjs/swagger';
import {
  ContentEntityType,
  ContentReviewDecision,
  ContentStatus,
  ExerciseType,
  MediaProcessingStatus,
  MediaType,
  Prisma,
} from '@prisma/client';

import { JSON_OBJECT_SCHEMA } from '../../../common/openapi/json-schemas';

// Response models of GET /admin/cms/exercises and /admin/cms/exercises/:id,
// matching EXERCISE_ADMIN_SELECT and EXERCISE_REVISION_SELECT.

export class AdminExerciseLessonDto {
  id!: number;
  title!: string;
  slug!: string;
}

export class AdminExerciseTopicDto {
  id!: number;
  title!: string;
}

export class AdminDataSourceDto {
  id!: number;
  code!: string;
  name!: string;
  version!: string;
}

export class AdminExerciseMediaDto {
  id!: number;
  url!: string;
  type!: MediaType;
  mimeType!: string | null;
  duration!: number | null;
  processingStatus!: MediaProcessingStatus;
  deletedAt!: Date | null;
}

export class AdminContentReviewDto {
  id!: number;
  reviewerId!: number | null;
  decision!: ContentReviewDecision;
  note!: string | null;
  createdAt!: Date;
}

export class AdminExerciseRevisionDto {
  id!: number;

  // Exercise endpoints only read revisions of this entity type.
  @ApiProperty({ enum: [ContentEntityType.lesson_exercise] })
  entityType!: ContentEntityType;

  entityId!: number;
  revision!: number;

  @ApiProperty(JSON_OBJECT_SCHEMA)
  snapshot!: Prisma.JsonValue;

  contentHash!: string | null;
  authorId!: number | null;
  createdAt!: Date;
  reviews!: AdminContentReviewDto[];
}

class AdminExerciseBaseDto {
  id!: number;
  lessonId!: number;
  topicId!: number | null;
  mediaId!: number | null;
  type!: ExerciseType;
  prompt!: string;

  @ApiProperty(JSON_OBJECT_SCHEMA)
  content!: Prisma.JsonValue;

  @ApiProperty(JSON_OBJECT_SCHEMA)
  answer!: Prisma.JsonValue;

  explanation!: string | null;
  version!: number;
  orderIndex!: number;
  status!: ContentStatus;
  dataSourceId!: number | null;
  sourceKey!: string | null;
  createdById!: number | null;
  updatedById!: number | null;
  publishedById!: number | null;
  publishedAt!: Date | null;
  deletedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
  lesson!: AdminExerciseLessonDto;
  topic!: AdminExerciseTopicDto | null;
  dataSource!: AdminDataSourceDto | null;
  media!: AdminExerciseMediaDto | null;
}

export class AdminExerciseDto extends AdminExerciseBaseDto {
  latestRevision!: AdminExerciseRevisionDto | null;
}

export class AdminExerciseDetailDto extends AdminExerciseBaseDto {
  /** Newest first. */
  revisions!: AdminExerciseRevisionDto[];
}
