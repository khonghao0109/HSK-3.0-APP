import { ContentStatus, QuestionType, Skill } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

import { POSTGRESQL_INT4_MAX } from '../../../common/constants/database.constants';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { QUESTION_AUTHORING_TYPES } from '../../../common/validation/question-authoring.validator';

export class AdminQuestionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  levelId?: number;

  @IsOptional()
  @IsEnum(Skill)
  skill?: Skill;

  // M4.1a exposes only the four objective formats (TL-77/82).
  @IsOptional()
  @IsIn([...QUESTION_AUTHORING_TYPES])
  type?: QuestionType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  difficulty?: number;

  @IsOptional()
  @IsEnum(ContentStatus)
  status?: ContentStatus;

  // TL-82b: `?tag=a&tag=b` (1–5 slug), kết hợp OR. Giá trị đơn được chuyển
  // thành mảng để một contract duy nhất cho cả một và nhiều tag.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined) return undefined;
    const values: unknown[] = Array.isArray(value)
      ? (value as unknown[])
      : [value];
    return values.map((item) =>
      typeof item === 'string' ? item.trim() : item,
    );
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  tag?: string[];

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  q?: string;
}
