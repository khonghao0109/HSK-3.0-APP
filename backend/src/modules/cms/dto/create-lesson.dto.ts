import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

import { CreateLessonRevisionDto } from './create-lesson-revision.dto';

export class CreateLessonDto extends CreateLessonRevisionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  levelId!: number;
}
