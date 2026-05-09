import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, Min } from 'class-validator';

export class GetLessonsQueryDto {
  @IsNotEmpty({
    message: 'levelId is required',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  levelId!: number;
}
