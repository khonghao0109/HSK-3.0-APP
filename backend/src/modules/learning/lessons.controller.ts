import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { LessonDetailResponseDto } from './dto/lesson-response.dto';
import { LearningService } from './learning.service';

@Controller('lessons')
export class LessonsController {
  constructor(private readonly learningService: LearningService) {}

  @Get(':id')
  async getLessonDetail(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<LessonDetailResponseDto> {
    return this.learningService.getLessonDetail(id);
  }
}
