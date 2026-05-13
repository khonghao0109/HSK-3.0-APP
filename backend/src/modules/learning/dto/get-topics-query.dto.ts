import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, Min } from 'class-validator';

export class GetTopicsQueryDto {
  @IsNotEmpty({
    message: 'lessonId is required',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  lessonId!: number;
}
