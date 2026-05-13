import { Module } from '@nestjs/common';
import { LearningController } from './learning.controller';
import { LevelsController } from './levels.controller';
import { LessonsController } from './lessons.controller';
import { LearningService } from './learning.service';
import { StoriesController } from './stories.controller';
import { TopicsController } from './topics.controller';

@Module({
  controllers: [
    LearningController,
    LevelsController,
    LessonsController,
    TopicsController,
    StoriesController,
  ],
  providers: [LearningService],
})
export class LearningModule {}
