import { Controller, Get, Query } from '@nestjs/common';
import { GetTopicsQueryDto } from './dto/get-topics-query.dto';
import { TopicsResponseDto } from './dto/topic-response.dto';
import { LearningService } from './learning.service';

@Controller('topics')
export class TopicsController {
  constructor(private readonly learningService: LearningService) {}

  @Get()
  async getTopics(
    @Query() query: GetTopicsQueryDto,
  ): Promise<TopicsResponseDto> {
    return this.learningService.getTopics(query);
  }
}
