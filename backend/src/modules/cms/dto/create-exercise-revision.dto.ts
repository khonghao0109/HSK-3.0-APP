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

/**
 * The Swagger CLI plugin bakes `enum` values for `type` from the TypeScript
 * union of `ExerciseType` in checker order, which depends on which
 * string-literal types were created first elsewhere in the program. Pin the
 * runtime order from the Prisma enum object (schema order) so `openapi.json`
 * stays byte-identical regardless of which other files are compiled.
 */
export function PinExerciseTypeEnumOrder(): ClassDecorator {
  return (target) => {
    const ctor = target as {
      _OPENAPI_METADATA_FACTORY?: () => Record<string, unknown>;
    };
    const original = ctor._OPENAPI_METADATA_FACTORY;
    if (typeof original !== 'function') return;
    ctor._OPENAPI_METADATA_FACTORY = () => {
      const metadata = original();
      const property = metadata.type;
      if (property !== undefined && typeof property === 'object') {
        const typed = property as { enum?: readonly string[] };
        if ('enum' in typed) typed.enum = Object.values(ExerciseType);
      }
      return metadata;
    };
  };
}

@PinExerciseTypeEnumOrder()
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
