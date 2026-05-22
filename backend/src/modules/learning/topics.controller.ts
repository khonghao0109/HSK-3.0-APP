import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiSuccessResponse,
  PaginationMeta,
} from '../../common/interfaces/api-response.interface';
import { GetTopicsQueryDto } from './dto/get-topics-query.dto';
import { TopicItemDto } from './dto/topic-response.dto';
import { LearningService } from './learning.service';

@Controller('topics')
export class TopicsController {
  constructor(private readonly learningService: LearningService) {}

  @Get()
  async getTopics(
    @Query() query: GetTopicsQueryDto,
  ): Promise<ApiSuccessResponse<TopicItemDto[], PaginationMeta>> {
    return this.learningService.getTopics(query);
  }
}
