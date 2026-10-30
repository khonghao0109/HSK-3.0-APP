import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

import { POSTGRESQL_INT4_MAX } from '../../../common/constants/database.constants';

import {
  TEST_DURATION_MAX,
  TEST_DURATION_MIN,
  TEST_INSTRUCTION_MAX_LENGTH,
  TEST_TITLE_MAX_LENGTH,
} from './create-test.dto';

/** TL-94/TL-97: optimistic concurrency token echoed from Test.updatedAt. */
export class TestMutationGuardDto {
  @IsISO8601()
  expectedUpdatedAt!: string;
}

/** TL-94/TL-97: patch only while the test is a draft. */
export class UpdateTestDto extends TestMutationGuardDto {
  // H1: an explicit `null` must fail validation instead of reaching Prisma as
  // a NOT NULL violation; only `undefined` means "leave unchanged".
  @ValidateIf((dto: UpdateTestDto) => dto.levelId !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  levelId?: number;

  @ValidateIf((dto: UpdateTestDto) => dto.title !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, TEST_TITLE_MAX_LENGTH)
  title?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(0, TEST_INSTRUCTION_MAX_LENGTH)
  instruction?: string | null;

  @ValidateIf((dto: UpdateTestDto) => dto.duration !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(TEST_DURATION_MIN)
  @Max(TEST_DURATION_MAX)
  duration?: number;

  // `null` clears the pass score; the range check against maxScore only runs
  // at publish time (TL-100).
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === null || value === undefined ? value : Number(value),
  )
  @IsInt()
  @Min(0)
  @Max(POSTGRESQL_INT4_MAX)
  passScore?: number | null;
}
