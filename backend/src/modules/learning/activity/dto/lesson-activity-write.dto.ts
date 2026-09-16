import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsInt, IsOptional, Max, Min } from 'class-validator';

import { JSON_OBJECT_SCHEMA } from '../../../../common/openapi/json-schemas';

export class EmptyLessonActivityWriteDto {}

export class SubmitLessonExerciseAttemptDto {
  // The scorer accepts only an object; its shape depends on the exercise type.
  @ApiProperty(JSON_OBJECT_SCHEMA)
  @IsDefined()
  answer!: unknown;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(86_400)
  durationSeconds?: number;
}
