import { Controller, Get } from '@nestjs/common';
import { LearningService } from './learning.service';
import { ApiResponse } from './interfaces/learning-response.interface';

@Controller('learning')
export class LearningController {
  constructor(private readonly learningService: LearningService) {}

  @Get('test')
  test(): ApiResponse<string> {
    return this.learningService.getTestMessage();
  }
}
