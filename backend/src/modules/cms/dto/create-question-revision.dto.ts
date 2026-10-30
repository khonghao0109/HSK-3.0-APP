import { ApiProperty } from '@nestjs/swagger';
import { QuestionType, Skill } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
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
import {
  QUESTION_AUTHORING_LIMITS,
  QUESTION_AUTHORING_TYPES,
} from '../../../common/validation/question-authoring.validator';

import { BoundedJsonPayload } from './bounded-json-payload.validator';

/**
 * M4.1a question revision body. `content` is the prompt; `answers` and
 * `correctAnswer` are the per-type JSON shapes validated after the DTO by
 * `validateQuestionAuthoring` (TL-78).
 */
export class CreateQuestionRevisionDto {
  @IsIn([...QUESTION_AUTHORING_TYPES])
  type!: QuestionType;

  @IsIn([Skill.listening, Skill.reading, Skill.writing, Skill.speaking])
  skill!: Skill;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  levelId!: number;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, QUESTION_AUTHORING_LIMITS.maxStringLength)
  content!: string;

  // The authoring validator accepts only objects for answers and correctAnswer.
  @ApiProperty(JSON_OBJECT_SCHEMA)
  @IsDefined()
  @Validate(BoundedJsonPayload)
  answers!: unknown;

  @ApiProperty(JSON_OBJECT_SCHEMA)
  @IsDefined()
  @Validate(BoundedJsonPayload)
  correctAnswer!: unknown;

  @IsOptional()
  @IsString()
  @Length(0, QUESTION_AUTHORING_LIMITS.maxStringLength)
  explanation?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, QUESTION_AUTHORING_LIMITS.maxObjectiveLength)
  objective?: string | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === null || value === undefined ? value : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(3)
  difficulty?: number | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === null || value === undefined ? value : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  audioId?: number | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === null || value === undefined ? value : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  imageId?: number | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? (value as unknown[]).map((item) =>
          typeof item === 'string' ? item.trim() : item,
        )
      : value,
  )
  @IsArray()
  @ArrayMaxSize(QUESTION_AUTHORING_LIMITS.maxTags)
  @IsString({ each: true })
  @Length(1, QUESTION_AUTHORING_LIMITS.maxTagNameLength, { each: true })
  tags?: string[];
}
