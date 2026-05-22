import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import {
  ApiSuccessResponse,
  PaginationMeta,
} from '../../common/interfaces/api-response.interface';
import { LearningService } from './learning.service';
import { LevelItemDto } from './dto/level-response.dto';
import { GetLessonsQueryDto } from './dto/get-lessons-query.dto';
import { GetStoriesQueryDto } from './dto/get-stories-query.dto';
import { GetTopicsQueryDto } from './dto/get-topics-query.dto';
import { LessonDetailDto, LessonItemDto } from './dto/lesson-response.dto';
import { StoryItemDto } from './dto/story-response.dto';
import { TopicItemDto } from './dto/topic-response.dto';

@Controller('learning')
export class LearningController {
  constructor(private readonly learningService: LearningService) {}

  @Get('test')
  test(): ApiSuccessResponse<string> {
    return this.learningService.getTestMessage();
  }

  @Get('levels')
  async getLevels(): Promise<ApiSuccessResponse<LevelItemDto[]>> {
    return this.learningService.getLevels();
  }

  @Get('lessons')
  async getLessons(
    @Query() query: GetLessonsQueryDto,
  ): Promise<ApiSuccessResponse<LessonItemDto[], PaginationMeta>> {
    return this.learningService.getLessons(query);
  }

  @Get('lessons/:id')
  async getLessonDetail(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApiSuccessResponse<LessonDetailDto>> {
    return this.learningService.getLessonDetail(id);
  }

  @Get('topics')
  async getTopics(
    @Query() query: GetTopicsQueryDto,
  ): Promise<ApiSuccessResponse<TopicItemDto[], PaginationMeta>> {
    return this.learningService.getTopics(query);
  }

  @Get('stories')
  async getStories(
    @Query() query: GetStoriesQueryDto,
  ): Promise<ApiSuccessResponse<StoryItemDto[], PaginationMeta>> {
    return this.learningService.getStories(query);
  }
}
