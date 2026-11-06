import { IsIn, IsOptional } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export const DATA_SOURCE_ELIGIBILITIES = ['media'] as const;
export type DataSourceEligibility = (typeof DATA_SOURCE_ELIGIBILITIES)[number];

export class AdminDataSourcesQueryDto extends PaginationQueryDto {
  /** Q103/TL-35: `media` keeps only sources media finalize would accept. */
  @IsOptional()
  @IsIn(DATA_SOURCE_ELIGIBILITIES)
  eligibleFor?: DataSourceEligibility;
}
