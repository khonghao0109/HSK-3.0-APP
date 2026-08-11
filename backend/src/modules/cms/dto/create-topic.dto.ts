import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

import { CreateTopicRevisionDto } from './create-topic-revision.dto';

export class CreateTopicDto extends CreateTopicRevisionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  lessonId!: number;
}
