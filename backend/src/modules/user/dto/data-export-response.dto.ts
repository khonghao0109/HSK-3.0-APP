import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DataExportItemDto {
  @ApiProperty({
    description: 'Data export job identifier',
    example: 1,
  })
  id!: number;

  @ApiProperty({
    description: 'Status of the data export job',
    example: 'completed',
  })
  status!: string;

  @ApiProperty({
    description: 'Timestamp when the export request was created',
    example: '2026-09-30T10:00:00.000Z',
  })
  createdAt!: string;

  @ApiPropertyOptional({
    description: 'Timestamp when the export was completed',
    nullable: true,
    example: '2026-09-30T10:05:00.000Z',
  })
  completedAt!: string | null;

  @ApiPropertyOptional({
    description:
      'Timestamp when the export output file expires (24 hours after completion)',
    nullable: true,
    example: '2026-10-01T10:05:00.000Z',
  })
  outputExpiresAt!: string | null;

  @ApiProperty({
    description: 'Indicates if the export is currently available for download',
    example: true,
  })
  downloadable!: boolean;
}
