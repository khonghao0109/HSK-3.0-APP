import { IsEmail, IsString, MinLength } from 'class-validator';

import { LOGIN_PASSWORD_MIN_LENGTH } from '../constants/password-policy';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  // Q360: tài khoản cũ có thể có mật khẩu 6–7 ký tự.
  @MinLength(LOGIN_PASSWORD_MIN_LENGTH)
  password!: string;
}
