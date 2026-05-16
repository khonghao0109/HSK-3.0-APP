import { Controller, Get, Query } from '@nestjs/common';
import { LearningService } from './learning.service';
import { ApiResponse } from './interfaces/learning-response.interface';
import { LevelsResponseDto } from './dto/level-response.dto';
import { GetLessonsQueryDto } from './dto/get-lessons-query.dto';
import { GetTopicsQueryDto } from './dto/get-topics-query.dto';
import { LessonsResponseDto } from './dto/lesson-response.dto';
import { TopicsResponseDto } from './dto/topic-response.dto';

@Controller('learning')
export class LearningController {
  constructor(private readonly learningService: LearningService) {}

  @Get('test')
  test(): ApiResponse<string> {
    return this.learningService.getTestMessage();
  }

  @Get('levels')
  async getLevels(): Promise<LevelsResponseDto> {
    return this.learningService.getLevels();
  }

  @Get('lessons')
  async getLessons(
    @Query() query: GetLessonsQueryDto,
  ): Promise<LessonsResponseDto> {
    return this.learningService.getLessons(query);
  }

  @Get('topics')
  async getTopics(
    @Query() query: GetTopicsQueryDto,
  ): Promise<TopicsResponseDto> {
    return this.learningService.getTopics(query);
  }
}
