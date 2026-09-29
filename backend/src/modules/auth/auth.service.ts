import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  type OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma, type Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';

import { PostgresThrottlerStorage } from '../../infrastructure/rate-limit/postgres-throttler.storage';
import { PrismaService } from '../../prisma/prisma.service';

import { WEAK_PASSWORDS } from './constants/weak-passwords';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
export const LOGIN_EMAIL_FAILURE_LIMIT = 5;
const LOGIN_EMAIL_WINDOW_MS = 15 * 60_000;
export const REFRESH_REUSE_GRACE_SECONDS = 10;

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyPasswordHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly rateLimitStorage: PostgresThrottlerStorage,
  ) {}

  /** Hash the timing decoy at boot so the first failed login is not slower. */
  async onModuleInit(): Promise<void> {
    await this.getDummyPasswordHash();
  }

  async register(registerDto: RegisterDto) {
    const email = this.normalizeEmail(registerDto.email);
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    this.assertPasswordNotBlacklisted(registerDto.password);
    const passwordHash = await this.hashPassword(registerDto.password);

    const user = await this.prisma.user
      .create({
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
      })
      .catch((error: unknown) => {
        // A concurrent registration won the unique email index.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException('Email already exists');
        }
        throw error;
      });

    return this.createSessionAndSignToken(user);
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

    // Unknown and inactive accounts get the same 401 as a wrong password, after
    // a full Argon2id verification against a decoy, so neither the status code
    // nor the response time reveals whether the email is registered.
    if (!user || user.status !== 'active' || user.deletedAt !== null) {
      await this.verifyPassword(
        loginDto.password,
        await this.getDummyPasswordHash(),
      );
      throw new UnauthorizedException('Invalid credentials');
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

    return this.createSessionAndSignToken({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });
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

  /**
   * Argon2id hash of a random secret with the same parameters and pepper as
   * real passwords, so verifying against it costs the same. Nothing can match
   * it: the secret is never stored or returned.
   */
  private getDummyPasswordHash(): Promise<string> {
    this.dummyPasswordHash ??= this.hashPassword(
      randomBytes(32).toString('base64url'),
    );
    return this.dummyPasswordHash;
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

  async refresh(refreshToken: string) {
    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');

    type RefreshTxResult =
      | {
          kind: 'issued';
          user: {
            id: number;
            email: string;
            role: Role;
            name: string | null;
          };
          session: {
            id: number;
            expiresAt: Date;
          };
          rawRefreshToken: string;
        }
      | {
          kind: 'account_inactive';
        }
      | {
          kind: 'not_claimed';
        };

    const txResult = await this.prisma.$transaction(
      async (tx): Promise<RefreshTxResult> => {
        const claimed = await tx.$queryRaw<
          Array<{
            id: number;
            userId: number;
            tokenHash: string;
            expiresAt: Date;
            revokedAt: Date | null;
            revocationReason: string | null;
          }>
        >`
          UPDATE "UserSession"
          SET "revokedAt" = CURRENT_TIMESTAMP,
              "revocationReason" = 'rotated',
              "lastSeenAt" = CURRENT_TIMESTAMP
          WHERE "tokenHash" = ${tokenHash}
            AND "revokedAt" IS NULL
            AND "expiresAt" > CURRENT_TIMESTAMP
          RETURNING "id", "userId", "tokenHash", "expiresAt", "revokedAt", "revocationReason"
        `;

        if (claimed.length !== 1) {
          return { kind: 'not_claimed' };
        }

        const session = claimed[0];
        const user = await tx.user.findUnique({
          where: { id: session.userId },
          select: {
            id: true,
            email: true,
            role: true,
            name: true,
            status: true,
            deletedAt: true,
          },
        });

        if (!user || user.status !== 'active' || user.deletedAt !== null) {
          await tx.$executeRaw`
            UPDATE "UserSession"
            SET "revocationReason" = 'account_inactive',
                "lastSeenAt" = CURRENT_TIMESTAMP
            WHERE "id" = ${session.id}
          `;
          return { kind: 'account_inactive' };
        }

        const newSession = await this.insertSession(tx, user.id);

        return {
          kind: 'issued',
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
            name: user.name,
          },
          session: {
            id: newSession.id,
            expiresAt: newSession.expiresAt,
          },
          rawRefreshToken: newSession.rawRefreshToken,
        };
      },
    );

    if (txResult.kind === 'issued') {
      const accessToken = await this.signToken(
        txResult.user.id,
        txResult.user.email,
        txResult.user.role,
        txResult.session.id,
      );

      return {
        user: txResult.user,
        accessToken,
        refreshToken: txResult.rawRefreshToken,
        refreshTokenExpiresAt: txResult.session.expiresAt.toISOString(),
      };
    }

    if (txResult.kind === 'account_inactive') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const rotatedSessions = await this.prisma.$queryRaw<
      Array<{
        id: number;
        userId: number;
        isWithinGrace: boolean;
      }>
    >`
      SELECT "id",
             "userId",
             ("revokedAt" > CURRENT_TIMESTAMP - (${REFRESH_REUSE_GRACE_SECONDS} * INTERVAL '1 second')) AS "isWithinGrace"
      FROM "UserSession"
      WHERE "tokenHash" = ${tokenHash}
        AND "revocationReason" = 'rotated'
    `;

    if (rotatedSessions.length > 0 && !rotatedSessions[0].isWithinGrace) {
      await this.prisma.$executeRaw`
        UPDATE "UserSession"
        SET "revokedAt" = CURRENT_TIMESTAMP,
            "revocationReason" = 'refresh_reuse',
            "lastSeenAt" = CURRENT_TIMESTAMP
        WHERE "userId" = ${rotatedSessions[0].userId}
          AND "revokedAt" IS NULL
      `;
    }

    throw new UnauthorizedException('Invalid refresh token');
  }

  async logout(sid: number): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "UserSession"
      SET "revokedAt" = CURRENT_TIMESTAMP,
          "revocationReason" = 'logout',
          "lastSeenAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${sid}
        AND "revokedAt" IS NULL
    `;
  }

  private getRefreshTokenTtlDays(): number {
    const configured = this.configService.get<number>(
      'jwt.refreshTokenTtlDays',
    );
    return typeof configured === 'number' &&
      Number.isSafeInteger(configured) &&
      configured >= 1 &&
      configured <= 90
      ? configured
      : 30;
  }

  private async insertSession(
    client: PrismaService | Prisma.TransactionClient,
    userId: number,
  ): Promise<{
    id: number;
    expiresAt: Date;
    rawRefreshToken: string;
  }> {
    const rawRefreshToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256')
      .update(rawRefreshToken)
      .digest('hex');
    const ttlDays = this.getRefreshTokenTtlDays();

    const createdSessions = await client.$queryRaw<
      Array<{
        id: number;
        expiresAt: Date;
      }>
    >`
      INSERT INTO "UserSession" (
        "userId",
        "tokenHash",
        "expiresAt",
        "createdAt",
        "lastSeenAt"
      )
      VALUES (
        ${userId},
        ${tokenHash},
        CURRENT_TIMESTAMP + (${ttlDays} * INTERVAL '1 day'),
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      RETURNING "id", "expiresAt"
    `;

    return {
      id: createdSessions[0].id,
      expiresAt: createdSessions[0].expiresAt,
      rawRefreshToken,
    };
  }

  private async createSessionAndSignToken(user: {
    id: number;
    email: string;
    role: Role;
    name: string | null;
  }) {
    const session = await this.insertSession(this.prisma, user.id);
    const accessToken = await this.signToken(
      user.id,
      user.email,
      user.role,
      session.id,
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
      accessToken,
      refreshToken: session.rawRefreshToken,
      refreshTokenExpiresAt: session.expiresAt.toISOString(),
    };
  }

  private async signToken(
    id: number,
    email: string,
    role: string,
    sid: number,
  ) {
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
        sid,
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
