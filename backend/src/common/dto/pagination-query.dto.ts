import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { POSTGRESQL_INT4_MAX } from '../constants/database.constants';

export class PaginationQueryDto {
  // `@IsInt` accepts values like 1e20; without a ceiling the computed offset
  // overflows Prisma's 64-bit `skip` and the request fails with 500.
  // Declared optional for OpenAPI: the plugin marks every property without
  // `?` as required, and cannot infer a type from the initializer alone.
  @ApiPropertyOptional({ type: 'integer' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POSTGRESQL_INT4_MAX)
  page = 1;

  @ApiPropertyOptional({ type: 'integer' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
