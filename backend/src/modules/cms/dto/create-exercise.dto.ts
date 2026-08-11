import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { POSTGRESQL_INT4_MAX } from '../../../common/constants/database.constants';

import { CreateExerciseRevisionDto } from './create-exercise-revision.dto';

export class CreateExerciseDto extends CreateExerciseRevisionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  lessonId!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  topicId?: number | null;
}
