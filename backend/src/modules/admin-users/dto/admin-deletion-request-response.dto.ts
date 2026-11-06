import { ApiProperty } from '@nestjs/swagger';

/**
 * M1.7d / Q203: the admin-initiated deletion always answers 201 with the same
 * shape, including on replay and on escalation of a user-initiated request.
 * `initiatedBy` is always `admin` here — the row it points at may have started
 * as `user` before escalation.
 */
export class AdminDeletionRequestResponseDto {
  @ApiProperty({
    description: 'ID of the account deletion request.',
    example: 1,
  })
  requestId!: number;

  @ApiProperty({
    description:
      'Scheduled date and time when the account will be permanently anonymized.',
    example: '2026-11-09T09:00:00.000Z',
  })
  scheduledAt!: Date;

  @ApiProperty({
    enum: ['admin'],
    example: 'admin',
    description: 'Who owns the request after this call; always `admin`.',
  })
  initiatedBy!: 'admin';
}
