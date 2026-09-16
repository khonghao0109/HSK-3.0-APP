import { Controller, Get } from '@nestjs/common';
import { ApiSuccessResponse } from '../../common/interfaces/api-response.interface';
import { ApiEnvelope } from '../../common/openapi/api-envelope.decorator';
import { LevelItemDto } from './dto/level-response.dto';
import { LearningService } from './learning.service';

@Controller('levels')
export class LevelsController {
  constructor(private readonly learningService: LearningService) {}

  @Get()
  @ApiEnvelope([LevelItemDto])
  async getLevels(): Promise<ApiSuccessResponse<LevelItemDto[]>> {
    return this.learningService.getLevels();
  }
}
