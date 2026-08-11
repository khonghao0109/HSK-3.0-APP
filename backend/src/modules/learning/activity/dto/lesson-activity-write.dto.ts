import { Type } from 'class-transformer';
import { IsDefined, IsInt, IsOptional, Max, Min } from 'class-validator';

export class EmptyLessonActivityWriteDto {}

export class SubmitLessonExerciseAttemptDto {
  @IsDefined()
  answer!: unknown;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(86_400)
  durationSeconds?: number;
}
