import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

import { ReviewQueueItemDto } from './review-queue-response.dto';

const SESSION_STATUSES = ['in_progress', 'completed', 'abandoned'] as const;
const GRADES = ['again', 'hard', 'good', 'easy'] as const;
const SCHEDULED_STATES = ['learning', 'review', 'relearning'] as const;

export class CreateReviewSessionDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: 50,
    default: 20,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

export class GradeReviewCardDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  cardId!: number;

  @ApiProperty({ enum: GRADES })
  @IsIn(GRADES)
  grade!: (typeof GRADES)[number];

  @ApiPropertyOptional({ type: 'integer', minimum: 0, maximum: 600_000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600_000)
  durationMs?: number;
}

export class ReviewSessionDto {
  sessionId!: number;

  @ApiProperty({ enum: SESSION_STATUSES })
  status!: (typeof SESSION_STATUSES)[number];

  plannedCount!: number;
  reviewedCount!: number;
  startedAt!: Date;
  /** Q253: last grade (or start) + 24 h; null once the session is closed. */
  expiresAt!: Date | null;
}

export class CreateReviewSessionResponseDto {
  /** false when the key was replayed or a live session was returned. */
  created!: boolean;
  session!: ReviewSessionDto;
}

export class CurrentReviewSessionResponseDto {
  session!: ReviewSessionDto;
  /** Ungraded, still available cards of the session, in session order. */
  items!: ReviewQueueItemDto[];
}

export class ReviewGradeNextDto {
  @ApiProperty({ enum: SCHEDULED_STATES })
  state!: (typeof SCHEDULED_STATES)[number];

  dueAt!: Date;
  intervalDays!: number;
}

export class ReviewGradeSessionCountsDto {
  reviewedCount!: number;
  plannedCount!: number;
}

export class GradeReviewCardResponseDto {
  replayed!: boolean;
  cardId!: number;

  @ApiProperty({ enum: GRADES })
  grade!: (typeof GRADES)[number];

  next!: ReviewGradeNextDto;
  session!: ReviewGradeSessionCountsDto;
}

export class ReviewSessionSummaryDto {
  again!: number;
  hard!: number;
  good!: number;
  easy!: number;
  remembered!: number;
  forgot!: number;
  /** round(remembered / reviewedCount * 100); null without reviews. */
  retentionPercent!: number | null;
  totalDurationMs!: number;
}

export class CompleteReviewSessionResponseDto {
  session!: ReviewSessionDto;
  summary!: ReviewSessionSummaryDto;
}
