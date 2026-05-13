import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, Min } from 'class-validator';

export class GetStoriesQueryDto {
  @IsNotEmpty({
    message: 'levelId is required',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  levelId!: number;
}
