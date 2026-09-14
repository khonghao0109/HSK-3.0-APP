import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';

import { PostgresThrottlerStorage } from '../../infrastructure/rate-limit/postgres-throttler.storage';
import { PrismaService } from '../../prisma/prisma.service';

import { WEAK_PASSWORDS } from './constants/weak-passwords';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
export const LOGIN_EMAIL_FAILURE_LIMIT = 5;
const LOGIN_EMAIL_WINDOW_MS = 15 * 60_000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly rateLimitStorage: PostgresThrottlerStorage,
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
    const emailThrottleKey = await this.consumeLoginEmailAttempt(email);
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        password: true,
        role: true,
        name: true,
        status: true,
        deletedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'active' || user.deletedAt !== null) {
      throw new ForbiddenException('Account is not active.');
    }

    if (!(await this.reserveLoginAttempt(user.id))) {
      throw new ForbiddenException(
        'Account temporarily locked. Please try again later.',
      );
    }

    const isPasswordValid = await this.verifyPassword(
      loginDto.password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockUntil: null,
        lastLoginAt: new Date(),
      },
    });
    await this.rateLimitStorage.reset(emailThrottleKey);

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

  /**
   * Counts a login attempt against the normalized email before any user
   * lookup, so unknown and existing accounts share one budget and a botnet
   * rotating IPs still gets LOGIN_EMAIL_FAILURE_LIMIT tries per window. A
   * successful login resets the counter, so only failures accumulate. The
   * stored key is a SHA-256 of the tracker, never the email itself.
   */
  private async consumeLoginEmailAttempt(email: string): Promise<string> {
    const key = createHash('sha256')
      .update(`login:email:${email}`)
      .digest('hex');
    const { isBlocked } = await this.rateLimitStorage.increment(
      key,
      LOGIN_EMAIL_WINDOW_MS,
      LOGIN_EMAIL_FAILURE_LIMIT,
      LOGIN_EMAIL_WINDOW_MS,
    );
    if (isBlocked) throw new ThrottlerException();
    return key;
  }

  /**
   * Claims one password verification for the account in a single UPDATE, as a
   * failure until a success resets it. The row lock serializes concurrent
   * attempts: at most MAX_LOGIN_ATTEMPTS claims pass per lock window, the one
   * reaching the limit sets `lockUntil`, and a locked account gets no claim, so
   * no Argon2 verification runs. An expired lock starts a new count.
   * `lockUntil` is `timestamp(3)` in UTC, so the database clock is read in UTC
   * regardless of the session time zone.
   */
  private async reserveLoginAttempt(userId: number): Promise<boolean> {
    const claimed = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
      UPDATE "User"
      SET
        "failedLoginAttempts" = CASE
          WHEN "lockUntil" IS NULL THEN "failedLoginAttempts" + 1
          ELSE 1
        END,
        "lockUntil" = CASE
          WHEN (CASE WHEN "lockUntil" IS NULL THEN "failedLoginAttempts" + 1 ELSE 1 END)
            >= ${MAX_LOGIN_ATTEMPTS}::integer
            THEN (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
              + ${LOCKOUT_MINUTES}::integer * INTERVAL '1 minute'
          ELSE NULL
        END,
        "updatedAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
      WHERE "id" = ${userId}
        AND ("lockUntil" IS NULL OR "lockUntil" <= CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      RETURNING "id"
    `);
    return claimed.length === 1;
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

  /**
   * Accepts only Argon2id hashes. A stored value in any other form (plaintext,
   * another Argon2 variant, a foreign algorithm) never matches, is not
   * re-hashed, and the account needs a password reset.
   */
  private async verifyPassword(
    password: string,
    hash: string,
  ): Promise<boolean> {
    if (!hash.startsWith('$argon2id$')) {
      return false;
    }

    try {
      return await argon2.verify(hash, `${password}${this.getPepper()}`);
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
