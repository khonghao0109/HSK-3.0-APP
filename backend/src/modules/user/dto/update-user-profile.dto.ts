import { ApiPropertyOptional } from '@nestjs/swagger';
import { Validate, ValidateIf } from 'class-validator';

import {
  IsValidDisplayNameConstraint,
  IsValidLocaleConstraint,
  IsValidTimezoneConstraint,
} from '../validation/user-profile.validator';

export class UpdateUserProfileDto {
  @ApiPropertyOptional({
    description:
      'User display name (1-50 Unicode code points, trimmed, no control or bidi override characters), or null to clear.',
    nullable: true,
    example: 'Nguyễn Văn A',
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Validate(IsValidDisplayNameConstraint)
  displayName?: string | null;

  @ApiPropertyOptional({
    description: 'Supported locale. Currently only "vi-VN" is supported.',
    example: 'vi-VN',
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Validate(IsValidLocaleConstraint)
  locale?: string;

  @ApiPropertyOptional({
    description: 'Valid IANA timezone identifier (up to 64 characters).',
    example: 'Asia/Ho_Chi_Minh',
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Validate(IsValidTimezoneConstraint)
  timezone?: string;
}
