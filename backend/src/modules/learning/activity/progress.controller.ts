import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ParsePositiveSafeIntegerPipe } from '../../../common/pipes/parse-positive-safe-integer.pipe';
import { LessonActivityService } from './lesson-activity.service';

type AuthenticatedRequest = Request & {
  user: { id: number; email: string; role: string };
};

@Controller('progress')
@UseGuards(JwtAuthGuard)
export class ProgressController {
  constructor(private readonly activityService: LessonActivityService) {}

  @Get('lessons')
  list(@Req() request: AuthenticatedRequest) {
    return this.activityService.getLessonProgressList(request.user.id);
  }

  @Get('lessons/:lessonId')
  detail(
    @Req() request: AuthenticatedRequest,
    @Param('lessonId', ParsePositiveSafeIntegerPipe) lessonId: number,
  ) {
    return this.activityService.getLessonProgress(request.user.id, lessonId);
  }
}
