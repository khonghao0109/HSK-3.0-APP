import { ApiProperty } from '@nestjs/swagger';
import { LearningPurpose } from '@prisma/client';

import {
  LEARNING_PATH_LESSON_STATES,
  type LearningPathLessonState,
} from '../learning-path.policy';

const ONBOARDING_NEXT_STEPS = [
  'set_goal',
  'content_unavailable',
  'generate_plan',
  'ready',
] as const;

export class LearningPathGoalDto {
  targetLevelCode!: string;
  targetBand!: number | null;

  @ApiProperty({
    enum: Object.values(LearningPurpose),
    nullable: true,
    type: String,
  })
  learningPurpose!: LearningPurpose | null;
}

export class LearningPathLessonDto {
  id!: number;
  title!: string;
  slug!: string;
  position!: number;

  @ApiProperty({ enum: LEARNING_PATH_LESSON_STATES })
  state!: LearningPathLessonState;

  completionPercent!: number;
}

export class LearningPathLevelDto {
  id!: number;
  code!: string;
  name!: string;
  orderIndex!: number;
  lessonCount!: number;
  completedCount!: number;
  lessons!: LearningPathLessonDto[];
}

export class LearningPathNextLessonDto {
  lessonId!: number;
  title!: string;
  slug!: string;
  levelCode!: string;
  position!: number;
}

export class LearningPathResponseDto {
  @ApiProperty({ enum: ONBOARDING_NEXT_STEPS })
  nextStep!: (typeof ONBOARDING_NEXT_STEPS)[number];

  goal!: LearningPathGoalDto | null;
  levels!: LearningPathLevelDto[];
  nextLesson!: LearningPathNextLessonDto | null;
}
