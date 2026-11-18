import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

import {
  ADMIN_USER_STATUSES,
  type AdminUserStatus,
} from '../admin-users.policy';

const ADMIN_ROLES = ['user', 'admin'] as const;

export class AdminUsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(ADMIN_ROLES)
  role?: 'user' | 'admin';

  @IsOptional()
  @IsIn(ADMIN_USER_STATUSES)
  status?: AdminUserStatus;

  // TL-61: trim, an all-whitespace search is treated as absent, and the value
  // is at most 100 characters. The service escapes LIKE metacharacters.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  })
  @IsString()
  @MaxLength(100)
  q?: string;
}
