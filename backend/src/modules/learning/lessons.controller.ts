import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import {
  ApiSuccessResponse,
  PaginationMeta,
} from '../../common/interfaces/api-response.interface';
import { GetLessonsQueryDto } from './dto/get-lessons-query.dto';
import { LessonDetailDto, LessonItemDto } from './dto/lesson-response.dto';
import { LearningService } from './learning.service';

@Controller('lessons')
export class LessonsController {
  constructor(private readonly learningService: LearningService) {}

  @Get()
  async getLessons(
    @Query() query: GetLessonsQueryDto,
  ): Promise<ApiSuccessResponse<LessonItemDto[], PaginationMeta>> {
    return this.learningService.getLessons(query);
  }

  @Get(':id')
  async getLessonDetail(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiSuccessResponse<LessonDetailDto>> {
    return this.learningService.getLessonDetail(id);
  }
}
