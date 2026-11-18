import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

import { POSTGRESQL_INT4_MAX } from '../../../common/constants/database.constants';

import { AdminTestDetailDto } from './admin-test-response.dto';
import { TEST_TITLE_MAX_LENGTH } from './create-test.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Q357: sinh đề draft từ blueprint, chọn câu trong ngân hàng câu hỏi. */
export class GenerateTestDto {
  /** `ExamBlueprint.code`, vd. `hsk1-standard`. */
  @Transform(trim)
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/u)
  @Length(1, 64)
  blueprintCode!: string;

  /** Cùng seed + cùng ngân hàng câu → cùng đề. Bỏ trống thì server tự tạo. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]+$/u)
  @Length(1, 64)
  seed?: string;

  /** Mặc định: tiêu đề blueprint kèm seed. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, TEST_TITLE_MAX_LENGTH)
  title?: string;

  /** `true`: dùng cả câu và bộ câu `draft` (xem trước khi duyệt). Mặc định chỉ `published`. */
  @IsOptional()
  @IsBoolean()
  includeDraft?: boolean;

  /** Không dùng lại câu của các đề này (sinh đề khác hẳn). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(POSTGRESQL_INT4_MAX, { each: true })
  excludeTestIds?: number[];
}

export class GeneratedTestPartDto {
  key!: string;
  /** Bộ câu đã dùng (phần `fromSet`), hoặc `null`. */
  setId!: number | null;
  questionIds!: number[];
}

export class GeneratedTestDto {
  blueprintCode!: string;
  seed!: string;
  parts!: GeneratedTestPartDto[];
  test!: AdminTestDetailDto;
}
