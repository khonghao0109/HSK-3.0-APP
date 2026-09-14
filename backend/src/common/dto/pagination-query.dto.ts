import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { POSTGRESQL_INT4_MAX } from '../constants/database.constants';

export class PaginationQueryDto {
  // `@IsInt` accepts values like 1e20; without a ceiling the computed offset
  // overflows Prisma's 64-bit `skip` and the request fails with 500.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
