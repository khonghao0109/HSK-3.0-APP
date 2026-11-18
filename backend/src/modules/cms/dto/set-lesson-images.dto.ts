import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { POSTGRESQL_INT4_MAX } from '../../../common/constants/database.constants';

export class LessonWordImageDto {
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  wordId!: number;

  /** `null` gỡ ảnh của từ; bắt buộc có trường. */
  @ValidateIf((o: LessonWordImageDto) => o.imageId !== null)
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  imageId!: number | null;
}

/** Q350: gán ảnh bìa bài học và ảnh từ trong bài; trường bỏ trống thì giữ nguyên. */
export class SetLessonImagesDto {
  /** `null` gỡ ảnh bìa. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  coverImageId?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LessonWordImageDto)
  wordImages?: LessonWordImageDto[];
}
