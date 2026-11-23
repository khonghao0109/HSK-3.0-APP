import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import type { ApiSuccessResponse } from '../../../common/interfaces/api-response.interface';
import { ApiEnvelope } from '../../../common/openapi/api-envelope.decorator';
import { OPENAPI_BEARER_AUTH } from '../../../common/openapi/openapi.constants';
import {
  LearningCourseDetailResponseDto,
  LearningCourseEnrollmentResponseDto,
  LearningCourseListResponseDto,
  SetCurrentCourseDto,
} from './dto/learning-course.dto';
import { LearningCourseService } from './learning-course.service';

type AuthenticatedRequest = Request & {
  user: { id: number; email: string; role: string };
};

/** Course reads, fixed in every environment like the review queue reads. */
export const COURSE_READ_LIMIT_PER_MINUTE = 60;

export function courseReadLimit(): number {
  return COURSE_READ_LIMIT_PER_MINUTE;
}

/** Enrollment and current-course writes, fixed in every environment. */
export const COURSE_WRITE_LIMIT_PER_MINUTE = 20;

export function courseWriteLimit(): number {
  return COURSE_WRITE_LIMIT_PER_MINUTE;
}

/** ADR-009 C3a learner course routes: JWT-only, `no-store`, own enrollments only. */
@Controller('learning')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth(OPENAPI_BEARER_AUTH)
export class LearningCourseController {
  constructor(private readonly courseService: LearningCourseService) {}

  @Get('courses')
  @Throttle({ default: { limit: courseReadLimit, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope(LearningCourseListResponseDto)
  listCourses(
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiSuccessResponse<LearningCourseListResponseDto>> {
    return this.courseService.listCourses(request.user.id);
  }

  @Get('courses/:code')
  @Throttle({ default: { limit: courseReadLimit, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope(LearningCourseDetailResponseDto)
  getCourse(
    @Req() request: AuthenticatedRequest,
    @Param('code') code: string,
  ): Promise<ApiSuccessResponse<LearningCourseDetailResponseDto>> {
    return this.courseService.getCourse(request.user.id, code);
  }

  @Post('courses/:code/enrollment')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: courseWriteLimit, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope(LearningCourseEnrollmentResponseDto)
  enroll(
    @Req() request: AuthenticatedRequest,
    @Param('code') code: string,
  ): Promise<ApiSuccessResponse<LearningCourseEnrollmentResponseDto>> {
    return this.courseService.enroll(request.user.id, code);
  }

  @Delete('courses/:code/enrollment')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: courseWriteLimit, ttl: 60_000 } })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Enrollment left, or there was none.',
  })
  async leave(
    @Req() request: AuthenticatedRequest,
    @Param('code') code: string,
  ): Promise<void> {
    await this.courseService.leave(request.user.id, code);
  }

  @Put('current-course')
  @Throttle({ default: { limit: courseWriteLimit, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiEnvelope(LearningCourseEnrollmentResponseDto)
  setCurrent(
    @Req() request: AuthenticatedRequest,
    @Body() body: SetCurrentCourseDto,
  ): Promise<ApiSuccessResponse<LearningCourseEnrollmentResponseDto>> {
    return this.courseService.setCurrent(request.user.id, body.courseCode);
  }
}
