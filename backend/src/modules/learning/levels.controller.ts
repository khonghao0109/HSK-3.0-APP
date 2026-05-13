import { Controller, Get } from '@nestjs/common';
import { LevelsResponseDto } from './dto/level-response.dto';
import { LearningService } from './learning.service';

@Controller('levels')
export class LevelsController {
  constructor(private readonly learningService: LearningService) {}

  @Get()
  async getLevels(): Promise<LevelsResponseDto> {
    return this.learningService.getLevels();
  }
}
