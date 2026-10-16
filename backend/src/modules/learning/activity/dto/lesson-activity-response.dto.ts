import { ApiProperty } from '@nestjs/swagger';
import { ExerciseType, ProgressStatus, TopicType } from '@prisma/client';

import { JSON_OBJECT_OR_ARRAY_SCHEMA } from '../../../../common/openapi/json-schemas';
import { LessonDetailExerciseMediaDto } from '../../dto/lesson-response.dto';
import { PUBLIC_LESSON_EXERCISE_TYPES } from '../../public-exercise.policy';
import {
  LEARNING_PATH_LESSON_STATES,
  type LearningPathLessonState,
} from '../../path/learning-path.policy';

// Response model of GET /learning/lessons/:lessonId/activity (Q43).

export const LESSON_ACTIVITY_NEXT_ACTIONS = [
  'start_lesson',
  'submit_exercise',
  'complete_topic',
  'complete_lesson',
  'completed',
] as const;

export type LessonActivityNextAction =
  (typeof LESSON_ACTIVITY_NEXT_ACTIONS)[number];

export class LessonActivityLessonDto {
  id!: number;
  title!: string;
  description!: string | null;
  slug!: string;
  orderIndex!: number;
  levelId!: number;
}

export class LessonActivityLevelDto {
  id!: number;
  code!: string;
  name!: string;
}

export class LessonActivityVocabularySectionDto {
  /** Same words as `GET /lessons/:id`. */
  wordCount!: number;
  /** Public topics of type `vocabulary`. */
  topicCount!: number;
  topicsDone!: number;
}

export class LessonActivityGrammarSectionDto {
  /** Public topics of type `grammar`. */
  topicCount!: number;
  topicsDone!: number;
}

export class LessonActivityPracticeSectionDto {
  /** Public exercises of the lesson, as listed in this response. */
  exerciseCount!: number;
  /** Exercises with at least one submitted attempt by the learner. */
  attempted!: number;
}

export class LessonActivitySectionsDto {
  vocabulary!: LessonActivityVocabularySectionDto;
  grammar!: LessonActivityGrammarSectionDto;
  practice!: LessonActivityPracticeSectionDto;
}

export class LessonActivityTopicProgressDto {
  status!: ProgressStatus;
  completionPercent!: number;
  timeSpentSeconds!: number;
  startedAt!: Date | null;
  completedAt!: Date | null;
  lastActivityAt!: Date | null;
}

export class LessonActivityProgressDto extends LessonActivityTopicProgressDto {
  score!: number | null;
}

export class LessonActivityAttemptDto {
  attemptId!: number;
  exerciseId!: number;
  attemptNumber!: number;
  isCorrect!: boolean | null;
  score!: number | null;
  durationSeconds!: number | null;
  exerciseVersion!: number;
  feedbackVersion!: string | null;
  explanation!: string | null;
  media!: LessonDetailExerciseMediaDto | null;
  submittedAt!: Date | null;
}

export class LessonActivityExerciseDto {
  id!: number;
  topicId!: number | null;

  /** Only publishable types reach learners; `speaking_repeat` never does. */
  @ApiProperty({ enum: PUBLIC_LESSON_EXERCISE_TYPES })
  type!: ExerciseType;

  prompt!: string;

  @ApiProperty(JSON_OBJECT_OR_ARRAY_SCHEMA)
  content!: unknown;

  version!: number;
  orderIndex!: number;
  media!: LessonDetailExerciseMediaDto | null;
  latestAttempt!: LessonActivityAttemptDto | null;
}

export class LessonActivityTopicDto {
  id!: number;
  title!: string;
  subtitle!: string | null;
  type!: TopicType;

  @ApiProperty(JSON_OBJECT_OR_ARRAY_SCHEMA)
  content!: unknown;

  orderIndex!: number;
  isPremium!: boolean;
  isLocked!: boolean;
  progress!: LessonActivityTopicProgressDto;
  exercises!: LessonActivityExerciseDto[];
}

export class LessonActivityCurrentTopicDto {
  id!: number;
  title!: string;
  orderIndex!: number;
}

export class LessonActivityResponseDto {
  lesson!: LessonActivityLessonDto;
  level!: LessonActivityLevelDto;

  /** 1..N among the ready lessons of the level, as in `GET /learning/path`. */
  position!: number;

  /** Q18 state, as in `GET /learning/path`; a locked lesson still reads. */
  @ApiProperty({ enum: LEARNING_PATH_LESSON_STATES })
  state!: LearningPathLessonState;

  sections!: LessonActivitySectionsDto;
  progress!: LessonActivityProgressDto;
  topics!: LessonActivityTopicDto[];
  standaloneExercises!: LessonActivityExerciseDto[];
  currentTopic!: LessonActivityCurrentTopicDto | null;
  currentExercise!: LessonActivityExerciseDto | null;

  @ApiProperty({ enum: LESSON_ACTIVITY_NEXT_ACTIONS })
  nextAction!: LessonActivityNextAction;
}
