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
import { LearningPathController } from './path/learning-path.controller';
import { LearningPathService } from './path/learning-path.service';
import { LearningHomeController } from './home/learning-home.controller';
import { LearningHomeService } from './home/learning-home.service';
import { ReviewController } from './review/review.controller';
import { ReviewService } from './review/review.service';
import { OnboardingModule } from '../onboarding/onboarding.module';

@Module({
  imports: [OnboardingModule],
  controllers: [
    LearningController,
    LevelsController,
    LessonsController,
    TopicsController,
    StoriesController,
    LessonActivityController,
    ProgressController,
    LearningPathController,
    LearningHomeController,
    ReviewController,
  ],
  providers: [
    LearningService,
    LessonActivityService,
    LessonActivityTransactionCoordinator,
    LearningPathService,
    LearningHomeService,
    ReviewService,
  ],
  exports: [LessonActivityService],
})
export class LearningModule {}
