import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

import { POSTGRESQL_INT4_MAX } from '../../../common/constants/database.constants';

export const TEST_TITLE_MAX_LENGTH = 200;
export const TEST_INSTRUCTION_MAX_LENGTH = 2_000;
export const TEST_DURATION_MIN = 1;
export const TEST_DURATION_MAX = 300;

/** TL-94/TL-100: create a draft test with no sections. */
export class CreateTestDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  levelId!: number;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, TEST_TITLE_MAX_LENGTH)
  title!: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(0, TEST_INSTRUCTION_MAX_LENGTH)
  instruction?: string | null;

  /** Whole-test duration in minutes (Q118). */
  @Type(() => Number)
  @IsInt()
  @Min(TEST_DURATION_MIN)
  @Max(TEST_DURATION_MAX)
  duration!: number;

  // Compared with maxScore at publish time only (TL-100).
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === null || value === undefined ? value : Number(value),
  )
  @IsInt()
  @Min(0)
  @Max(POSTGRESQL_INT4_MAX)
  passScore?: number | null;
}
