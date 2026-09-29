import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token (32 bytes base64url encoded, 43 characters)',
    example: 'dGhpcy1pcy1hLTMyLWJ5dGUtcmFuZG9tLXRva2VuLTIwMjY',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/, {
    message: 'Invalid refresh token format',
  })
  refreshToken!: string;
}
