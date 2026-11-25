import { ApiProperty } from '@nestjs/swagger';
import { CourseKind } from '@prisma/client';

import { LearningCourseProgressDto } from '../../course/dto/learning-course.dto';
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

/** C3b-UI2: a lesson of the current course, with or without a Level. */
export class LearningHomeCourseLessonDto {
  lessonId!: number;
  title!: string;
  slug!: string;
  /** Position inside its course unit (starts at 1). */
  position!: number;
  completionPercent!: number;
}

/** C3b-UI2: summary of the course being studied (ADR-009 Q-C4). */
export class LearningHomeCurrentCourseDto {
  code!: string;
  title!: string;

  @ApiProperty({ enum: Object.values(CourseKind) })
  kind!: CourseKind;

  progress!: LearningCourseProgressDto;
  /**
   * Lesson "Học tiếp" opens. A topic course gives the same lesson as
   * `continueLesson`; another kind gives its own next lesson and
   * `continueLesson` is then `null`.
   */
  nextLesson!: LearningHomeCourseLessonDto | null;
}

export class LearningHomeResponseDto {
  @ApiProperty({ enum: ONBOARDING_NEXT_STEPS })
  nextStep!: (typeof ONBOARDING_NEXT_STEPS)[number];

  greetingName!: string | null;
  dailyGoal!: LearningHomeDailyGoalDto | null;
  streakDays!: number;
  continueLesson!: LearningHomeContinueLessonDto | null;
  /** C3b-UI2: `null` when no published course is current. */
  currentCourse?: LearningHomeCurrentCourseDto | null;
}
