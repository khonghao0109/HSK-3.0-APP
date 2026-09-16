import { ApiProperty } from '@nestjs/swagger';
import { ExerciseType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  Validate,
} from 'class-validator';

import { POSTGRESQL_INT4_MAX } from '../../../common/constants/database.constants';
import { JSON_OBJECT_SCHEMA } from '../../../common/openapi/json-schemas';
import { LESSON_EXERCISE_ORDER_INDEX_LIMITS } from '../../../common/validation/lesson-exercise-authoring.validator';

import { BoundedJsonPayload } from './bounded-json-payload.validator';

export class CreateExerciseRevisionDto {
  @IsEnum(ExerciseType)
  type!: ExerciseType;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 4_096)
  prompt!: string;

  // The authoring validator accepts only objects for content and answer.
  @ApiProperty(JSON_OBJECT_SCHEMA)
  @IsDefined()
  @Validate(BoundedJsonPayload)
  content!: unknown;

  @ApiProperty(JSON_OBJECT_SCHEMA)
  @IsDefined()
  @Validate(BoundedJsonPayload)
  answer!: unknown;

  @IsOptional()
  @IsString()
  @Length(0, 4_096)
  explanation?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(LESSON_EXERCISE_ORDER_INDEX_LIMITS.min)
  @Max(LESSON_EXERCISE_ORDER_INDEX_LIMITS.max)
  orderIndex!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  mediaId?: number | null;
}
