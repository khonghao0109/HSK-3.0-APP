import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

import { NEW_PASSWORD_MIN_LENGTH } from '../constants/password-policy';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(NEW_PASSWORD_MIN_LENGTH)
  password!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;
}
