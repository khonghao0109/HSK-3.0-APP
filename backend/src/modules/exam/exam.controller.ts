import {
  Body,
  Controller,
  Get,
  Header,
  HttpStatus,
  Param,
  Post,
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
import { ExamAttemptViewDto, ExamTestIntroDto } from './dto/exam-response.dto';
import { StartExamAttemptDto } from './dto/start-exam-attempt.dto';
import { ExamService } from './exam.service';

type AuthenticatedRequest = Request & {
  user: { id: number; email: string; role: string };
};

/** Learner write-route limit, matching the M2.4 exercise attempt route. */
export const EXAM_ATTEMPT_LIMIT_PER_MINUTE = 60;

export function examAttemptLimit(): number {
  return process.env.NODE_ENV === 'test'
    ? 1_000
    : EXAM_ATTEMPT_LIMIT_PER_MINUTE;
}

/**
 * M4.2a learner exam endpoints (TL-110). Every route is JWT-only, `no-store`
 * and validates its path id with `ParsePositiveSafeIntegerPipe`; a learner can
 * only ever read and start their own attempts.
 */
@Controller('exam')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth(OPENAPI_BEARER_AUTH)
export class ExamController {
  constructor(private readonly examService: ExamService) {}

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
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope(ExamAttemptViewDto)
  getAttempt(
    @Req() request: AuthenticatedRequest,
    @Param('attemptId', ParsePositiveSafeIntegerPipe) attemptId: number,
  ): Promise<ApiSuccessResponse<ExamAttemptViewDto>> {
    return this.examService.getAttemptView(request.user.id, attemptId);
  }
}
