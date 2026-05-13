import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { GetLessonsQueryDto } from './dto/get-lessons-query.dto';
import {
  LessonDetailResponseDto,
  LessonsResponseDto,
} from './dto/lesson-response.dto';
import { LearningService } from './learning.service';

@Controller('lessons')
export class LessonsController {
  constructor(private readonly learningService: LearningService) {}

  @Get()
  async getLessons(
    @Query() query: GetLessonsQueryDto,
  ): Promise<LessonsResponseDto> {
    return this.learningService.getLessons(query);
  }

  @Get(':id')
  async getLessonDetail(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<LessonDetailResponseDto> {
    return this.learningService.getLessonDetail(id);
  }
}
