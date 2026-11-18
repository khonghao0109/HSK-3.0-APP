import { Skill } from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  EXAM_LEVEL_CODES,
  EXAM_LIST_SORTS,
  type ExamLevelCode,
  type ExamListSort,
} from '../exam-list.model';

/**
 * M4.5 B1: query of `GET /exam/tests`. Every value is validated here so a bad
 * filter is a `400 REQUEST_VALIDATION_FAILED` from the global validation pipe
 * rather than an empty page. `page`/`limit` come from `PaginationQueryDto`
 * (same 1–100 ceiling as the other learner lists).
 */
export class ListExamTestsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: EXAM_LEVEL_CODES,
    description: 'Level code (`Level.code`); omit for every level.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsIn(EXAM_LEVEL_CODES)
  levelCode?: ExamLevelCode;

  @ApiPropertyOptional({ enum: Skill })
  @IsOptional()
  @IsEnum(Skill)
  skill?: Skill;

  @ApiPropertyOptional({
    enum: EXAM_LIST_SORTS,
    default: 'newest',
    description:
      'newest/oldest by publishedAt, score by the latest finished attempt.',
  })
  @IsOptional()
  @IsIn(EXAM_LIST_SORTS)
  sort?: ExamListSort;
}
