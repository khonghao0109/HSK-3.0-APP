import { Controller, Get, Query } from '@nestjs/common';
import { GetStoriesQueryDto } from './dto/get-stories-query.dto';
import { StoriesResponseDto } from './dto/lesson-response.dto';
import { LearningService } from './learning.service';

@Controller('stories')
export class StoriesController {
  constructor(private readonly learningService: LearningService) {}

  @Get()
  async getStories(
    @Query() query: GetStoriesQueryDto,
  ): Promise<StoriesResponseDto> {
    return this.learningService.getStories(query);
  }
}
