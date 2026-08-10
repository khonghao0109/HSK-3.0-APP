import { Module } from '@nestjs/common';

import { LearningPlansController } from './learning-plans.controller';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  controllers: [OnboardingController, LearningPlansController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
