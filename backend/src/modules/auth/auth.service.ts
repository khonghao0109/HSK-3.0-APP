import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';

import { PrismaService } from '../../prisma/prisma.service';

import { WEAK_PASSWORDS } from './constants/weak-passwords';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(registerDto: RegisterDto) {
    const email = this.normalizeEmail(registerDto.email);
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      throw new UnauthorizedException('Email already exists');
    }

    this.assertPasswordNotBlacklisted(registerDto.password);
    const passwordHash = await this.hashPassword(registerDto.password);

    const user = await this.prisma.user.create({
      data: {
        email,
        password: passwordHash,
        name: registerDto.name,
      },
      select: {
        id: true,
        email: true,
        role: true,
        name: true,
      },
    });

    const accessToken = await this.signToken(user.id, user.email, user.role);

    return {
      user,
      accessToken,
    };
  }

  async login(loginDto: LoginDto) {
    const email = this.normalizeEmail(loginDto.email);
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        password: true,
        role: true,
        name: true,
        failedLoginAttempts: true,
        lockUntil: true,
        status: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'active') {
      throw new ForbiddenException('Account is not active.');
    }

    if (user.lockUntil && user.lockUntil > new Date()) {
      throw new ForbiddenException(
        'Account temporarily locked. Please try again later.',
      );
    }

    const isPasswordValid = await this.verifyPassword(
      loginDto.password,
      user.password,
    );

    if (!isPasswordValid) {
      const failedAttempts = user.failedLoginAttempts + 1;
      const lockUntil =
        failedAttempts >= MAX_LOGIN_ATTEMPTS
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
          : null;

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts:
            failedAttempts >= MAX_LOGIN_ATTEMPTS ? 0 : failedAttempts,
          lockUntil,
        },
      });

      throw new UnauthorizedException('Invalid credentials');
    }

    const upgradedPassword = !user.password.startsWith('$argon2id$')
      ? await this.hashPassword(loginDto.password)
      : undefined;

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockUntil: null,
        lastLoginAt: new Date(),
        ...(upgradedPassword ? { password: upgradedPassword } : {}),
      },
    });

    const accessToken = await this.signToken(user.id, user.email, user.role);

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
      accessToken,
    };
  }

  private assertPasswordNotBlacklisted(password: string) {
    if (WEAK_PASSWORDS.has(password.toLowerCase())) {
      throw new BadRequestException('Password is too weak.');
    }
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private getPepper(): string {
    return this.configService.get<string>('AUTH_PASSWORD_PEPPER') ?? '';
  }

  private async hashPassword(password: string): Promise<string> {
    const passwordWithPepper = `${password}${this.getPepper()}`;

    return argon2.hash(passwordWithPepper, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });
  }

  private async verifyPassword(
    password: string,
    hash: string,
  ): Promise<boolean> {
    const passwordWithPepper = `${password}${this.getPepper()}`;

    if (!hash.startsWith('$argon2id$')) {
      return hash === password;
    }

    try {
      return await argon2.verify(hash, passwordWithPepper);
    } catch {
      return false;
    }
  }

  private async signToken(id: number, email: string, role: string) {
    const jwtSecrets =
      this.configService.get<Record<string, string>>('jwt.secrets') ?? {};
    const activeKid = this.configService.get<string>('jwt.activeKid') ?? 'v1';
    const secret = jwtSecrets[activeKid];

    if (!secret) {
      throw new UnauthorizedException('JWT secret configuration is invalid.');
    }

    return this.jwtService.signAsync(
      {
        sub: id,
        email,
        role,
      },
      {
        secret,
        header: {
          kid: activeKid,
          alg: 'HS256',
        },
      },
    );
  }
}
