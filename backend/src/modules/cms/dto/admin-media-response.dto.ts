import {
  ContentStatus,
  MediaProcessingStatus,
  MediaType,
} from '@prisma/client';

import { AdminDataSourceDto } from './admin-exercise-response.dto';

// Response models of the admin media library, matching projectAdminMedia.

export class AdminMediaDto {
  id!: number;
  /** Sanitized original filename. */
  filename!: string | null;
  type!: MediaType;
  mimeType!: string | null;
  size!: number | null;
  duration!: number | null;
  processingStatus!: MediaProcessingStatus;
  lifecycle!: 'active' | 'archived';
  usageCount!: number;
  dataSourceId!: number | null;
  uploadedById!: number | null;
  updatedById!: number | null;
  deletedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
  dataSource!: AdminDataSourceDto | null;
}

export class AdminMediaExerciseUsageDto {
  id!: number;
  lessonId!: number;
  topicId!: number | null;
  prompt!: string;
  status!: ContentStatus;
}

export class AdminMediaUsageCountsDto {
  lessonExercises!: number;
  otherContent!: number;
}

export class AdminMediaUsageDto {
  /** First 50 by id. */
  lessonExercises!: AdminMediaExerciseUsageDto[];
  counts!: AdminMediaUsageCountsDto;
}

export class AdminMediaDetailDto extends AdminMediaDto {
  usage!: AdminMediaUsageDto;
}

/** Result of archive and quarantine; `idempotent` when nothing changed. */
export class AdminMediaLifecycleResultDto {
  idempotent!: boolean;
  media!: AdminMediaDto;
}
