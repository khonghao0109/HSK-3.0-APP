import { Controller, Get } from '@nestjs/common';
import { LearningService } from './learning.service';
import { ApiResponse } from './interfaces/learning-response.interface';
import { LevelsResponseDto } from './dto/level-response.dto';

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
}
