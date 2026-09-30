import { ApiProperty } from '@nestjs/swagger';

export class AccountDeletionResponseDto {
  @ApiProperty({
    description: 'ID of the account deletion request.',
    example: 1,
  })
  requestId!: number;

  @ApiProperty({
    description:
      'Scheduled date and time when the account will be permanently anonymized.',
    example: '2026-10-07T09:00:00.000Z',
  })
  scheduledAt!: Date;
}
