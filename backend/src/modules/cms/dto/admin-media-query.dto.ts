import { MediaProcessingStatus, MediaType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

import { POSTGRESQL_INT4_MAX } from '../../../common/constants/database.constants';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export const MEDIA_LIFECYCLES = ['active', 'archived'] as const;
export type MediaLifecycleFilter = (typeof MEDIA_LIFECYCLES)[number];

export class AdminMediaQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(MediaType)
  type?: MediaType;

  @IsOptional()
  @IsEnum(MediaProcessingStatus)
  processingStatus?: MediaProcessingStatus;

  @IsOptional()
  @IsIn(MEDIA_LIFECYCLES)
  lifecycle?: MediaLifecycleFilter;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  dataSourceId?: number;
}
