import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import type { ApiSuccessResponse } from '../../../common/interfaces/api-response.interface';
import { ApiEnvelope } from '../../../common/openapi/api-envelope.decorator';
import { OPENAPI_BEARER_AUTH } from '../../../common/openapi/openapi.constants';
import { ReviewQueueQueryDto } from './dto/review-queue-query.dto';
import { ReviewQueueResponseDto } from './dto/review-queue-response.dto';
import { ReviewService } from './review.service';

type AuthenticatedRequest = Request & {
  user: { id: number; email: string; role: string };
};

/** Read route, fixed in every environment like `GET /exam/attempts/:id`. */
export const REVIEW_QUEUE_READ_LIMIT_PER_MINUTE = 60;

export function reviewQueueReadLimit(): number {
  return REVIEW_QUEUE_READ_LIMIT_PER_MINUTE;
}

/** M3.2 learner review routes (Q251–Q254): JWT-only, `no-store`, own cards only. */
@Controller('review')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth(OPENAPI_BEARER_AUTH)
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @Get('queue')
  @Throttle({ default: { limit: reviewQueueReadLimit, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope(ReviewQueueResponseDto)
  getQueue(
    @Req() request: AuthenticatedRequest,
    @Query() query: ReviewQueueQueryDto,
  ): Promise<ApiSuccessResponse<ReviewQueueResponseDto>> {
    return this.reviewService.getQueue(
      request.user.id,
      query.limit,
      new Date(),
    );
  }
}
