import { ApiProperty } from '@nestjs/swagger';

export class CreateDataExportResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the data export job',
    example: 1,
  })
  exportId!: number;

  @ApiProperty({
    description: 'Current status of the data export job',
    example: 'requested',
  })
  status!: string;
}
