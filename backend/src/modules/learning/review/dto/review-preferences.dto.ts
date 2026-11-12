import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

import { DAILY_CARD_LIMITS } from '../review-preferences';

/** M3.3c (Q279–Q280): body of `PUT /review/preferences`. */
export class UpdateReviewPreferencesDto {
  @ApiProperty({ enum: DAILY_CARD_LIMITS, type: 'integer' })
  @IsIn(DAILY_CARD_LIMITS)
  dailyCardLimit!: number;

  /** Public Level codes; empty means every level. */
  @ApiProperty({ type: [String], maxItems: 20 })
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(32, { each: true })
  levelCodes!: string[];
}

export class ReviewLevelOptionDto {
  code!: string;
  name!: string;
}

export class ReviewPreferencesResponseDto {
  @ApiProperty({ enum: DAILY_CARD_LIMITS, type: 'integer' })
  dailyCardLimit!: number;

  /** Saved filter; empty means every level. */
  levelCodes!: string[];

  /** Every published, not deleted Level, by `orderIndex`: the filter choices. */
  levels!: ReviewLevelOptionDto[];
}
