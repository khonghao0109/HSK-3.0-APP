import { Type } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/**
 * TL-121/TL-124: bodies of the two autosave routes. The per-type answer shape
 * is validated against the frozen snapshot in `exam-answer.validator.ts`, not
 * here, because the snapshot (not the DTO) knows the option and token ids.
 */
export const EXAM_ANSWER_BATCH_LIMITS = {
  minItems: 1,
  maxItems: 20,
  maxQuestionKeyLength: 64,
  maxClientElapsedMs: 86_400_000,
} as const;

export class SaveExamAnswerBodyDto {
  /**
   * Any JSON value passes the DTO so that a *wrong shape* is reported by
   * `validateExamAnswerShape` as `400 EXAM_ANSWER_INVALID` with the documented
   * `details.field` (TL-122); `undefined` is rejected by the service too.
   * `null` clears the answer and keeps the flag (TL-121).
   */
  @Allow()
  answer!: unknown;

  @IsBoolean()
  isFlagged!: boolean;

  /** Must be present and is `null` for "create"; `undefined` is a 400. */
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsInt()
  @Min(1)
  expectedVersion!: number | null;

  @IsUUID()
  idempotencyKey!: string;

  // Not `@IsOptional()`: null is not a documented value, only an absent field.
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(EXAM_ANSWER_BATCH_LIMITS.maxClientElapsedMs)
  clientElapsedMs?: number;
}

export class SaveExamAnswersItemDto extends SaveExamAnswerBodyDto {
  /** Shape/pattern is checked against the snapshot by the service. */
  @IsString()
  @Length(1, EXAM_ANSWER_BATCH_LIMITS.maxQuestionKeyLength)
  questionKey!: string;
}

export class SaveExamAnswersDto {
  @IsArray()
  @ArrayMinSize(EXAM_ANSWER_BATCH_LIMITS.minItems)
  @ArrayMaxSize(EXAM_ANSWER_BATCH_LIMITS.maxItems)
  @ValidateNested({ each: true })
  @Type(() => SaveExamAnswersItemDto)
  items!: SaveExamAnswersItemDto[];
}
