import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class ConfirmEmailVerificationDto {
  @ApiProperty({
    description: 'Raw email verification token (43-character base64url string)',
    example: 'abcdefghijklmnopqrstuvwxyz0123456789-_ABCDE',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9_-]{43}$/, {
    message: 'Token must be a valid 43-character base64url string.',
  })
  token!: string;
}
