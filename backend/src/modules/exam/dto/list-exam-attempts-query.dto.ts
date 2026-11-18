import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { EXAM_LEVEL_CODES, type ExamLevelCode } from '../exam-list.model';

/** M4.5 B3: query of `GET /exam/attempts`. */
export class ListExamAttemptsQueryDto extends PaginationQueryDto {
  // Redeclared whole: a subclass's validators replace the inherited ones.
  @ApiPropertyOptional({ type: 'integer', maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @ApiPropertyOptional({
    enum: EXAM_LEVEL_CODES,
    description: 'Level code frozen in the attempt; omit for every level.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsIn(EXAM_LEVEL_CODES)
  levelCode?: ExamLevelCode;
}
