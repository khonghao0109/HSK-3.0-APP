import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const MEDIA_ALT_TEXT_MAX_LENGTH = 1_000;

export class MediaIngestionQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  dataSourceId!: number;

  /** Q350: alt tiếng Việt, lưu vào `Media.metadata.altText` (bất biến sau ingest). */
  @ApiPropertyOptional({ maxLength: MEDIA_ALT_TEXT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MEDIA_ALT_TEXT_MAX_LENGTH)
  @Matches(/\S/u, { message: 'altText must not be blank' })
  altText?: string;
}
