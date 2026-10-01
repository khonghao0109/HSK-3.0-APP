import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class RequestAccountDeletionDto {
  @ApiProperty({
    description: 'Current password for confirming account deletion.',
    example: 'StrongPassword123!',
  })
  @IsString()
  @IsNotEmpty()
  password!: string;

  @ApiPropertyOptional({
    description:
      'Optional reason for deleting the account (up to 500 characters).',
    maxLength: 500,
    example: 'No longer studying Chinese.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
