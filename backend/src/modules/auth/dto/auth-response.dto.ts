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

/** Result of register and login. */
export class AuthTokenResponseDto {
  user!: AuthAccountDto;
  accessToken!: string;
}

export class AuthMeResponseDto {
  user!: AuthUserDto;
}
