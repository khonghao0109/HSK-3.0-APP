import { ApiProperty } from '@nestjs/swagger';

import {
  LearningPathNextLessonDto,
  ONBOARDING_NEXT_STEPS,
} from '../../path/dto/learning-path-response.dto';

export class LearningHomeDailyGoalDto {
  targetMinutes!: number;
  minutesToday!: number;
}

export class LearningHomeContinueLessonDto extends LearningPathNextLessonDto {
  completionPercent!: number;
}

export class LearningHomeResponseDto {
  @ApiProperty({ enum: ONBOARDING_NEXT_STEPS })
  nextStep!: (typeof ONBOARDING_NEXT_STEPS)[number];

  greetingName!: string | null;
  dailyGoal!: LearningHomeDailyGoalDto | null;
  streakDays!: number;
  continueLesson!: LearningHomeContinueLessonDto | null;
}
