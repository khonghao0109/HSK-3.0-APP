import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class GetTopicsQueryDto extends PaginationQueryDto {
  @IsNotEmpty({
    message: 'lessonId is required',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  lessonId!: number;
}
