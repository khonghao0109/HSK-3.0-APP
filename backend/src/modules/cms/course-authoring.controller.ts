import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';

import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OPENAPI_BEARER_AUTH } from '../../common/openapi/openapi.constants';
import { correlationId } from '../../common/utils/request-correlation';

import { CmsActor } from './cms-workflow';
import { CmsService } from './cms.service';
import { CourseAuthoringService } from './course-authoring.service';
import {
  AdminCourseUnitsQueryDto,
  AdminCoursesQueryDto,
  CreateCourseDto,
  CreateCourseUnitDto,
  CreateCourseUnitLessonDto,
  UpdateCourseDto,
  UpdateCourseUnitDto,
} from './dto/course-authoring.dto';
import { ParsePositiveIntPipe } from './pipes/parse-positive-int.pipe';

type AuthenticatedRequest = Request & { user: CmsActor };

/**
 * ADR-009 C3b-2: Course and CourseUnit CMS. Same guards as CmsController and,
 * like every CMS route, only the global default throttler.
 */
@Controller('admin/cms')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@ApiBearerAuth(OPENAPI_BEARER_AUTH)
export class CourseAuthoringController {
  constructor(
    private readonly courses: CourseAuthoringService,
    private readonly cmsService: CmsService,
  ) {}

  @Get('courses')
  listCourses(
    @Req() request: AuthenticatedRequest,
    @Query() query: AdminCoursesQueryDto,
  ) {
    return this.courses.listCourses(request.user, query);
  }

  @Get('courses/:courseId')
  getCourse(
    @Req() request: AuthenticatedRequest,
    @Param('courseId', ParsePositiveIntPipe) courseId: number,
  ) {
    return this.courses.getCourse(request.user, courseId);
  }

  @Post('courses')
  createCourse(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateCourseDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.courses.createCourse(request.user, dto, {
      correlationId: correlationId(requestId),
    });
  }

  @Patch('courses/:courseId')
  updateCourse(
    @Req() request: AuthenticatedRequest,
    @Param('courseId', ParsePositiveIntPipe) courseId: number,
    @Body() dto: UpdateCourseDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.courses.updateCourse(request.user, courseId, dto, {
      correlationId: correlationId(requestId),
    });
  }

  @Post('courses/:courseId/publish')
  publishCourse(
    @Req() request: AuthenticatedRequest,
    @Param('courseId', ParsePositiveIntPipe) courseId: number,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.courses.publishCourse(request.user, courseId, {
      correlationId: correlationId(requestId),
    });
  }

  @Post('courses/:courseId/archive')
  archiveCourse(
    @Req() request: AuthenticatedRequest,
    @Param('courseId', ParsePositiveIntPipe) courseId: number,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.courses.archiveCourse(request.user, courseId, {
      correlationId: correlationId(requestId),
    });
  }

  @Get('course-units')
  listUnits(
    @Req() request: AuthenticatedRequest,
    @Query() query: AdminCourseUnitsQueryDto,
  ) {
    return this.courses.listUnits(request.user, query);
  }

  @Post('course-units')
  createUnit(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateCourseUnitDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.courses.createUnit(request.user, dto, {
      correlationId: correlationId(requestId),
    });
  }

  @Patch('course-units/:unitId')
  updateUnit(
    @Req() request: AuthenticatedRequest,
    @Param('unitId', ParsePositiveIntPipe) unitId: number,
    @Body() dto: UpdateCourseUnitDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.courses.updateUnit(request.user, unitId, dto, {
      correlationId: correlationId(requestId),
    });
  }

  @Post('course-units/:unitId/publish')
  publishUnit(
    @Req() request: AuthenticatedRequest,
    @Param('unitId', ParsePositiveIntPipe) unitId: number,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.courses.publishUnit(request.user, unitId, {
      correlationId: correlationId(requestId),
    });
  }

  @Post('course-units/:unitId/archive')
  archiveUnit(
    @Req() request: AuthenticatedRequest,
    @Param('unitId', ParsePositiveIntPipe) unitId: number,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.courses.archiveUnit(request.user, unitId, {
      correlationId: correlationId(requestId),
    });
  }

  @Post('course-units/:unitId/lessons')
  createUnitLesson(
    @Req() request: AuthenticatedRequest,
    @Param('unitId', ParsePositiveIntPipe) unitId: number,
    @Body() dto: CreateCourseUnitLessonDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.cmsService.createCourseUnitLesson(request.user, unitId, dto, {
      correlationId: correlationId(requestId),
    });
  }
}
