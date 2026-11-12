import { ApiProperty } from '@nestjs/swagger';

import { DictionaryWordDetailDto } from '../../../dictionary/dto/dictionary-word-response.dto';

const REVIEW_CARD_STATES = [
  'new',
  'learning',
  'review',
  'relearning',
  'suspended',
] as const;
const SCHEDULED_STATES = ['learning', 'review', 'relearning'] as const;

export class ReviewGradePreviewDto {
  @ApiProperty({ enum: SCHEDULED_STATES })
  state!: (typeof SCHEDULED_STATES)[number];

  dueAt!: Date;
  intervalDays!: number;
}

export class ReviewPreviewDto {
  again!: ReviewGradePreviewDto;
  hard!: ReviewGradePreviewDto;
  good!: ReviewGradePreviewDto;
  easy!: ReviewGradePreviewDto;
}

export class ReviewQueueItemDto {
  cardId!: number;

  @ApiProperty({ enum: REVIEW_CARD_STATES })
  state!: (typeof REVIEW_CARD_STATES)[number];

  dueAt!: Date;
  word!: DictionaryWordDetailDto;
  /** What each grade would do, computed with the request's `now`. */
  preview!: ReviewPreviewDto;
}

export class ReviewQueueResponseDto {
  /** Every due card (Q252), not cut by `limit`. */
  dueCount!: number;
  items!: ReviewQueueItemDto[];
}
