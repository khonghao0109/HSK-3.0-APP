import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiSuccessResponse,
  PaginationMeta,
} from '../../common/interfaces/api-response.interface';
import { GetStoriesQueryDto } from './dto/get-stories-query.dto';
import { StoryItemDto } from './dto/story-response.dto';
import { LearningService } from './learning.service';

@Controller('stories')
export class StoriesController {
  constructor(private readonly learningService: LearningService) {}

  @Get()
  async getStories(
    @Query() query: GetStoriesQueryDto,
  ): Promise<ApiSuccessResponse<StoryItemDto[], PaginationMeta>> {
    return this.learningService.getStories(query);
  }
}
