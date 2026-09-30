import { ApiProperty } from '@nestjs/swagger';

export class UserProfileResponseDto {
  @ApiProperty({
    description: 'User display name, or null if unset.',
    nullable: true,
    example: 'Nguyễn Văn A',
  })
  displayName!: string | null;

  @ApiProperty({
    description: 'Supported locale identifier.',
    example: 'vi-VN',
  })
  locale!: string;

  @ApiProperty({
    description: 'IANA timezone identifier.',
    example: 'Asia/Ho_Chi_Minh',
  })
  timezone!: string;
}
