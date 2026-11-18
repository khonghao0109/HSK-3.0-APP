import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const trimOptional = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value.trim() === ''
      ? undefined
      : value.trim()
    : value;

export class AdminAuditLogsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(64)
  targetType?: string;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(64)
  targetId?: string;
}
