import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { Request } from 'express';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { OPENAPI_BEARER_AUTH } from '../../../common/openapi/openapi.constants';
import { ParsePositiveSafeIntegerPipe } from '../../../common/pipes/parse-positive-safe-integer.pipe';
import {
  EmptyLessonActivityWriteDto,
  SubmitLessonExerciseAttemptDto,
} from './dto/lesson-activity-write.dto';
import { LessonActivityService } from './lesson-activity.service';

const IDEMPOTENCY_KEY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description:
    'Replaying a key with the same request returns the original result.',
};

type AuthenticatedRequest = Request & {
  user: { id: number; email: string; role: string };
};

@Controller('learning')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth(OPENAPI_BEARER_AUTH)
export class LessonActivityController {
  constructor(private readonly activityService: LessonActivityService) {}

  @Post('lessons/:lessonId/start')
  @ApiHeader(IDEMPOTENCY_KEY_HEADER)
  startLesson(
    @Req() request: AuthenticatedRequest,
    @Param('lessonId', ParsePositiveSafeIntegerPipe) lessonId: number,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: EmptyLessonActivityWriteDto,
  ) {
    void body;
    return this.activityService.startLesson(
      request.user.id,
      lessonId,
      idempotencyKey,
    );
  }

  @Get('lessons/:lessonId/activity')
  getLessonActivity(
    @Req() request: AuthenticatedRequest,
    @Param('lessonId', ParsePositiveSafeIntegerPipe) lessonId: number,
  ) {
    return this.activityService.getLessonActivity(request.user.id, lessonId);
  }

  @Post('lessons/:lessonId/complete')
  @ApiHeader(IDEMPOTENCY_KEY_HEADER)
  completeLesson(
    @Req() request: AuthenticatedRequest,
    @Param('lessonId', ParsePositiveSafeIntegerPipe) lessonId: number,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: EmptyLessonActivityWriteDto,
  ) {
    void body;
    return this.activityService.completeLesson(
      request.user.id,
      lessonId,
      idempotencyKey,
    );
  }

  @Post('topics/:topicId/start')
  @ApiHeader(IDEMPOTENCY_KEY_HEADER)
  startTopic(
    @Req() request: AuthenticatedRequest,
    @Param('topicId', ParsePositiveSafeIntegerPipe) topicId: number,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: EmptyLessonActivityWriteDto,
  ) {
    void body;
    return this.activityService.startTopic(
      request.user.id,
      topicId,
      idempotencyKey,
    );
  }

  @Post('topics/:topicId/complete')
  @ApiHeader(IDEMPOTENCY_KEY_HEADER)
  completeTopic(
    @Req() request: AuthenticatedRequest,
    @Param('topicId', ParsePositiveSafeIntegerPipe) topicId: number,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: EmptyLessonActivityWriteDto,
  ) {
    void body;
    return this.activityService.completeTopic(
      request.user.id,
      topicId,
      idempotencyKey,
    );
  }

  @Post('exercises/:exerciseId/attempts')
  @ApiHeader(IDEMPOTENCY_KEY_HEADER)
  submitAttempt(
    @Req() request: AuthenticatedRequest,
    @Param('exerciseId', ParsePositiveSafeIntegerPipe) exerciseId: number,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: SubmitLessonExerciseAttemptDto,
  ) {
    return this.activityService.submitAttempt(
      request.user.id,
      exerciseId,
      dto,
      idempotencyKey,
    );
  }

  @Get('exercises/:exerciseId/attempts')
  getAttempts(
    @Req() request: AuthenticatedRequest,
    @Param('exerciseId', ParsePositiveSafeIntegerPipe) exerciseId: number,
  ) {
    return this.activityService.getAttempts(request.user.id, exerciseId);
  }
}
