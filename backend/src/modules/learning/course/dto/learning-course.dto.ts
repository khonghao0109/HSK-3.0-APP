import { ApiProperty } from '@nestjs/swagger';
import {
  CourseEnrollmentStatus,
  CourseKind,
  CourseVolume,
} from '@prisma/client';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import {
  LEARNING_PATH_LESSON_STATES,
  type LearningPathLessonState,
} from '../../path/learning-path.policy';

export class LearningCourseProgressDto {
  completedLessons!: number;
  totalLessons!: number;
}

export class LearningCourseSummaryDto {
  code!: string;

  @ApiProperty({ enum: Object.values(CourseKind) })
  kind!: CourseKind;

  @ApiProperty({ type: String, nullable: true })
  curriculumVersion!: string | null;

  title!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  /** An `active` enrollment exists. */
  enrolled!: boolean;
  /** Course being studied, the default course included (ADR-009 Q-C4). */
  isCurrent!: boolean;
  progress!: LearningCourseProgressDto;
}

export class LearningCourseListResponseDto {
  courses!: LearningCourseSummaryDto[];
}

export class LearningCourseLessonDto {
  id!: number;
  title!: string;
  slug!: string;
  position!: number;

  @ApiProperty({ enum: LEARNING_PATH_LESSON_STATES })
  state!: LearningPathLessonState;

  completionPercent!: number;
}

export class LearningCourseUnitDto {
  orderIndex!: number;
  title!: string;

  @ApiProperty({ type: 'integer', nullable: true })
  gradeNumber!: number | null;

  @ApiProperty({
    enum: Object.values(CourseVolume),
    nullable: true,
    type: String,
  })
  volume!: CourseVolume | null;

  @ApiProperty({ type: String, nullable: true })
  levelCode!: string | null;

  lessons!: LearningCourseLessonDto[];
}

export class LearningCourseDetailResponseDto extends LearningCourseSummaryDto {
  units!: LearningCourseUnitDto[];
}

export class LearningCourseEnrollmentResponseDto {
  courseCode!: string;

  @ApiProperty({ enum: Object.values(CourseEnrollmentStatus) })
  status!: CourseEnrollmentStatus;

  isCurrent!: boolean;
  enrolledAt!: Date;

  @ApiProperty({ type: Date, nullable: true })
  leftAt!: Date | null;
}

export class SetCurrentCourseDto {
  @ApiProperty({ maxLength: 64 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  courseCode!: string;
}
