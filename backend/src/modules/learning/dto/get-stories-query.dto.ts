import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class GetStoriesQueryDto extends PaginationQueryDto {
  @IsNotEmpty({
    message: 'levelId is required',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  levelId!: number;
}
