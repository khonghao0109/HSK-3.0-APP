import { Module } from '@nestjs/common';
import { LearningController } from './learning.controller';
import { LevelsController } from './levels.controller';
import { LessonsController } from './lessons.controller';
import { LearningService } from './learning.service';
import { StoriesController } from './stories.controller';
import { TopicsController } from './topics.controller';
import { LessonActivityController } from './activity/lesson-activity.controller';
import { LessonActivityService } from './activity/lesson-activity.service';
import { LessonActivityTransactionCoordinator } from './activity/lesson-activity-transaction-coordinator';
import { ProgressController } from './activity/progress.controller';

@Module({
  controllers: [
    LearningController,
    LevelsController,
    LessonsController,
    TopicsController,
    StoriesController,
    LessonActivityController,
    ProgressController,
  ],
  providers: [
    LearningService,
    LessonActivityService,
    LessonActivityTransactionCoordinator,
  ],
  exports: [LessonActivityService],
})
export class LearningModule {}
