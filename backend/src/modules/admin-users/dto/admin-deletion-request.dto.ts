import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

/**
 * M1.7d / Q203: an admin may only open an under-age deletion, and `under_age`
 * is the only reason the API accepts. There is deliberately no free-text
 * `note`: the reason is a closed enum so the stored audit trail cannot carry
 * admin-authored PII.
 */
export const ADMIN_DELETION_REASONS = ['under_age'] as const;

export type AdminDeletionReason = (typeof ADMIN_DELETION_REASONS)[number];

export class AdminDeletionRequestDto {
  @ApiProperty({
    enum: ADMIN_DELETION_REASONS,
    example: 'under_age',
    description: 'Only `under_age` is accepted (Q203).',
  })
  @IsIn(ADMIN_DELETION_REASONS)
  reason!: AdminDeletionReason;
}
