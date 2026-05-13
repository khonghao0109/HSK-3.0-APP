import { Module } from '@nestjs/common';
import { LearningController } from './learning.controller';
import { LessonsController } from './lessons.controller';
import { LearningService } from './learning.service';

@Module({
  controllers: [LearningController, LessonsController],
  providers: [LearningService],
})
export class LearningModule {}
