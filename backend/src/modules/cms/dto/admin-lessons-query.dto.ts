import { ContentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

import { POSTGRESQL_INT4_MAX } from '../../../common/constants/database.constants';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class AdminLessonsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  levelId?: number;

  /** ADR-009 C3b-2: lessons of one course (through their unit). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  courseId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  courseUnitId?: number;

  @IsOptional()
  @IsEnum(ContentStatus)
  status?: ContentStatus;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  search?: string;
}
