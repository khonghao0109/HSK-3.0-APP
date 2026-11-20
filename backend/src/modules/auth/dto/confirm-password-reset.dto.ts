import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

import { NEW_PASSWORD_MIN_LENGTH } from '../constants/password-policy';

export class ConfirmPasswordResetDto {
  @ApiProperty({
    description: 'Raw password reset token (43-character base64url string)',
    example: 'abcdefghijklmnopqrstuvwxyz0123456789-_ABCDE',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9_-]{43}$/, {
    message: 'Token must be a valid 43-character base64url string.',
  })
  token!: string;

  @ApiProperty({
    description: 'New password for the account (minimum 8 characters)',
    example: 'NewSecret123!',
  })
  @IsString()
  @MinLength(NEW_PASSWORD_MIN_LENGTH)
  newPassword!: string;
}
