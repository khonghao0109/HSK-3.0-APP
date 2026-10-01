import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class RequestPasswordResetDto {
  @ApiProperty({
    description: 'Email address of the account',
    example: 'learner@example.com',
  })
  @IsEmail()
  email!: string;
}
