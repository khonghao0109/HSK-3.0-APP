import {
  Body,
  Controller,
  Get,
  Header,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { ApiSuccessResponse } from '../../common/interfaces/api-response.interface';
import { ApiEnvelope } from '../../common/openapi/api-envelope.decorator';
import { OPENAPI_BEARER_AUTH } from '../../common/openapi/openapi.constants';
import { ParsePositiveSafeIntegerPipe } from '../../common/pipes/parse-positive-safe-integer.pipe';
import {
  ExamAnswerBatchViewDto,
  ExamAnswerSaveViewDto,
  ExamAttemptViewDto,
  ExamMediaGrantsDto,
  ExamTestIntroDto,
} from './dto/exam-response.dto';
import {
  SaveExamAnswerBodyDto,
  SaveExamAnswersDto,
} from './dto/save-exam-answer.dto';
import { StartExamAttemptDto } from './dto/start-exam-attempt.dto';
import { ExamMediaGrantsService } from './exam-media-grants.service';
import { ExamService } from './exam.service';

type AuthenticatedRequest = Request & {
  user: { id: number; email: string; role: string };
};

/** Learner write-route limit, matching the M2.4 exercise attempt route. */
export const EXAM_ATTEMPT_LIMIT_PER_MINUTE = 60;

/**
 * TL-130: autosave is chatty (one request per answered question) and only the
 * single-save limit is raised under `NODE_ENV=test` so an e2e suite can save
 * many answers for one learner; the batch and the two reads keep their
 * documented production limits in every environment.
 */
export const EXAM_ANSWER_SAVE_LIMIT_PER_MINUTE = 240;
export const EXAM_ANSWER_BATCH_LIMIT_PER_MINUTE = 60;
export const EXAM_ATTEMPT_READ_LIMIT_PER_MINUTE = 60;
export const EXAM_MEDIA_GRANT_LIMIT_PER_MINUTE = 30;

function testAwareLimit(limit: number): number {
  return process.env.NODE_ENV === 'test' ? 1_000 : limit;
}

export function examAttemptLimit(): number {
  return testAwareLimit(EXAM_ATTEMPT_LIMIT_PER_MINUTE);
}

export function examAnswerSaveLimit(): number {
  return testAwareLimit(EXAM_ANSWER_SAVE_LIMIT_PER_MINUTE);
}

export function examAnswerBatchLimit(): number {
  return EXAM_ANSWER_BATCH_LIMIT_PER_MINUTE;
}

export function examAttemptReadLimit(): number {
  return EXAM_ATTEMPT_READ_LIMIT_PER_MINUTE;
}

export function examMediaGrantLimit(): number {
  return EXAM_MEDIA_GRANT_LIMIT_PER_MINUTE;
}

/**
 * M4.2a/M4.2b learner exam endpoints (TL-110, TL-121, TL-124, TL-127, TL-128).
 * Every route is JWT-only, `no-store` and validates its path ids with
 * `ParsePositiveSafeIntegerPipe`; a learner can only ever read, start and save
 * their own attempts.
 */
@Controller('exam')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth(OPENAPI_BEARER_AUTH)
export class ExamController {
  constructor(
    private readonly examService: ExamService,
    private readonly examMediaGrants: ExamMediaGrantsService,
  ) {}

  @Get('tests/:testId')
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope(ExamTestIntroDto)
  getTestIntro(
    @Req() request: AuthenticatedRequest,
    @Param('testId', ParsePositiveSafeIntegerPipe) testId: number,
  ): Promise<ApiSuccessResponse<ExamTestIntroDto>> {
    return this.examService.getTestIntro(request.user.id, testId);
  }

  @Post('tests/:testId/attempts')
  // One start per second per user is plenty: the same request replays the
  // stored attempt instead of creating a second one (TL-112).
  @Throttle({ default: { limit: examAttemptLimit, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope(ExamAttemptViewDto)
  @ApiResponse({
    status: HttpStatus.OK,
    description:
      'Existing attempt for this learner and test: idempotent replay or the live attempt.',
  })
  async startAttempt(
    @Req() request: AuthenticatedRequest,
    @Param('testId', ParsePositiveSafeIntegerPipe) testId: number,
    @Body() dto: StartExamAttemptDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ApiSuccessResponse<ExamAttemptViewDto>> {
    const result = await this.examService.startAttempt(
      request.user.id,
      testId,
      dto.idempotencyKey,
    );
    // 201 for a new attempt, 200 for a replay or the live attempt (TL-112).
    response.status(result.created ? 201 : 200);
    return { success: true, data: result.data };
  }

  @Get('attempts/:attemptId')
  @Throttle({ default: { limit: examAttemptReadLimit, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope(ExamAttemptViewDto)
  getAttempt(
    @Req() request: AuthenticatedRequest,
    @Param('attemptId', ParsePositiveSafeIntegerPipe) attemptId: number,
  ): Promise<ApiSuccessResponse<ExamAttemptViewDto>> {
    return this.examService.getAttemptView(request.user.id, attemptId);
  }

  @Get('attempts/:attemptId/media-grants')
  @Throttle({ default: { limit: examMediaGrantLimit, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope(ExamMediaGrantsDto)
  async getMediaGrants(
    @Req() request: AuthenticatedRequest,
    @Param('attemptId', ParsePositiveSafeIntegerPipe) attemptId: number,
  ): Promise<ApiSuccessResponse<ExamMediaGrantsDto>> {
    const target = await this.examService.getMediaGrantTarget(
      request.user.id,
      attemptId,
    );
    return {
      success: true,
      data: await this.examMediaGrants.createGrants({
        mediaIds: target.mediaIds,
        remainingSeconds: target.remainingSeconds,
      }),
    };
  }

  @Put('attempts/:attemptId/answers/:questionKey')
  @Throttle({ default: { limit: examAnswerSaveLimit, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope(ExamAnswerSaveViewDto)
  saveAnswer(
    @Req() request: AuthenticatedRequest,
    @Param('attemptId', ParsePositiveSafeIntegerPipe) attemptId: number,
    @Param('questionKey') questionKey: string,
    @Body() dto: SaveExamAnswerBodyDto,
  ): Promise<ApiSuccessResponse<ExamAnswerSaveViewDto>> {
    return this.examService.saveAnswer(
      request.user.id,
      attemptId,
      questionKey,
      dto,
    );
  }

  @Put('attempts/:attemptId/answers')
  @Throttle({ default: { limit: examAnswerBatchLimit, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope(ExamAnswerBatchViewDto)
  saveAnswers(
    @Req() request: AuthenticatedRequest,
    @Param('attemptId', ParsePositiveSafeIntegerPipe) attemptId: number,
    @Body() dto: SaveExamAnswersDto,
  ): Promise<ApiSuccessResponse<ExamAnswerBatchViewDto>> {
    return this.examService.saveAnswers(request.user.id, attemptId, dto.items);
  }
}
