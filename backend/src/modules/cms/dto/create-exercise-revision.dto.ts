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

  @IsDefined()
  @Validate(BoundedJsonPayload)
  content!: unknown;

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
