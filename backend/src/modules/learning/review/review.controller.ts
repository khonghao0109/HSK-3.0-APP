import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import type { ApiSuccessResponse } from '../../../common/interfaces/api-response.interface';
import { ApiEnvelope } from '../../../common/openapi/api-envelope.decorator';
import { OPENAPI_BEARER_AUTH } from '../../../common/openapi/openapi.constants';
import { ParsePositiveSafeIntegerPipe } from '../../../common/pipes/parse-positive-safe-integer.pipe';
import { ReviewOverviewResponseDto } from './dto/review-overview-response.dto';
import { ReviewQueueQueryDto } from './dto/review-queue-query.dto';
import { ReviewQueueResponseDto } from './dto/review-queue-response.dto';
import {
  CompleteReviewSessionResponseDto,
  CreateReviewSessionDto,
  CreateReviewSessionResponseDto,
  CurrentReviewSessionResponseDto,
  GradeReviewCardDto,
  GradeReviewCardResponseDto,
} from './dto/review-session.dto';
import { ReviewSessionService } from './review-session.service';
import { ReviewService } from './review.service';

type AuthenticatedRequest = Request & {
  user: { id: number; email: string; role: string };
};

/** Read route, fixed in every environment like `GET /exam/attempts/:id`. */
export const REVIEW_QUEUE_READ_LIMIT_PER_MINUTE = 60;

export function reviewQueueReadLimit(): number {
  return REVIEW_QUEUE_READ_LIMIT_PER_MINUTE;
}

/** Create and complete a session (Q253), fixed in every environment. */
export const REVIEW_SESSION_WRITE_LIMIT_PER_MINUTE = 20;

export function reviewSessionWriteLimit(): number {
  return REVIEW_SESSION_WRITE_LIMIT_PER_MINUTE;
}

/** One grade per card, so a session of 50 cards fits well inside a minute. */
export const REVIEW_GRADE_LIMIT_PER_MINUTE = 120;

export function reviewGradeLimit(): number {
  return REVIEW_GRADE_LIMIT_PER_MINUTE;
}

const IDEMPOTENCY_KEY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description:
    'Replaying a key with the same request returns the original result.',
};

/** M3.2 learner review routes (Q251–Q254): JWT-only, `no-store`, own cards only. */
@Controller('review')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth(OPENAPI_BEARER_AUTH)
export class ReviewController {
  constructor(
    private readonly reviewService: ReviewService,
    private readonly reviewSessionService: ReviewSessionService,
  ) {}

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

  /** M3.3b (Q268): due today, 3/7/14-day windows, 7-day retention, calendar, recent sessions. */
  @Get('overview')
  @Throttle({ default: { limit: reviewQueueReadLimit, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope(ReviewOverviewResponseDto)
  getOverview(
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiSuccessResponse<ReviewOverviewResponseDto>> {
    return this.reviewService.getOverview(request.user.id, new Date());
  }

  @Post('sessions')
  @Throttle({ default: { limit: reviewSessionWriteLimit, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiHeader(IDEMPOTENCY_KEY_HEADER)
  @ApiEnvelope(CreateReviewSessionResponseDto)
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Replayed key or the live session (`created: false`).',
  })
  async createSession(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateReviewSessionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ApiSuccessResponse<CreateReviewSessionResponseDto>> {
    const result = await this.reviewSessionService.createSession(
      request.user.id,
      dto.limit,
      idempotencyKey,
    );
    response.status(result.data.created ? 201 : 200);
    return result;
  }

  @Get('sessions/current')
  @Throttle({ default: { limit: reviewQueueReadLimit, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope(CurrentReviewSessionResponseDto)
  getCurrentSession(
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiSuccessResponse<CurrentReviewSessionResponseDto>> {
    return this.reviewSessionService.getCurrentSession(
      request.user.id,
      new Date(),
    );
  }

  @Post('sessions/:sessionId/reviews')
  @Throttle({ default: { limit: reviewGradeLimit, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiHeader(IDEMPOTENCY_KEY_HEADER)
  @ApiEnvelope(GradeReviewCardResponseDto)
  gradeCard(
    @Req() request: AuthenticatedRequest,
    @Param('sessionId', ParsePositiveSafeIntegerPipe) sessionId: number,
    @Body() dto: GradeReviewCardDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<ApiSuccessResponse<GradeReviewCardResponseDto>> {
    return this.reviewSessionService.gradeCard(
      request.user.id,
      sessionId,
      dto,
      idempotencyKey,
    );
  }

  @Post('sessions/:sessionId/complete')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: reviewSessionWriteLimit, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope(CompleteReviewSessionResponseDto)
  completeSession(
    @Req() request: AuthenticatedRequest,
    @Param('sessionId', ParsePositiveSafeIntegerPipe) sessionId: number,
  ): Promise<ApiSuccessResponse<CompleteReviewSessionResponseDto>> {
    return this.reviewSessionService.completeSession(
      request.user.id,
      sessionId,
    );
  }
}
