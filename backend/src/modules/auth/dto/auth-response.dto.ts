import { Role } from '@prisma/client';

/** Principal attached by JwtStrategy. */
export class AuthUserDto {
  id!: number;
  email!: string;
  role!: Role;
}

export class AuthAccountDto extends AuthUserDto {
  name!: string | null;
}

/** Result of register, login, and refresh. */
export class AuthTokenResponseDto {
  user!: AuthAccountDto;
  accessToken!: string;
  refreshToken!: string;
  refreshTokenExpiresAt!: string;
}

export class AuthMeResponseDto {
  user!: AuthUserDto;
}
