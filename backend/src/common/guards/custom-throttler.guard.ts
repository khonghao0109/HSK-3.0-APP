import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';

type TrackedRequest = {
  ip?: string;
  user?: unknown;
  headers?: { authorization?: unknown };
};

/**
 * Buckets authenticated traffic per user and anonymous traffic per client IP.
 *
 * As an APP_GUARD this runs before controller and route guards, so
 * `req.user` from JwtAuthGuard is not populated yet. The bearer token is
 * therefore verified here (kid, HS256 signature, expiry) without a database
 * lookup, only to choose the bucket; route guards still decide access. A
 * missing, forged or expired token falls back to the IP bucket.
 */
@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  private readonly jwtService = new JwtService();

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly configService: ConfigService,
  ) {
    super(options, storageService, reflector);
  }

  protected override async getTracker(req: TrackedRequest): Promise<string> {
    const userId =
      positiveUserId(
        typeof req.user === 'object' && req.user !== null && 'id' in req.user
          ? req.user.id
          : undefined,
      ) ?? (await this.verifiedBearerUserId(req.headers?.authorization));
    return userId === undefined ? ipTracker(req) : `user:${userId}`;
  }

  private async verifiedBearerUserId(
    authorization: unknown,
  ): Promise<number | undefined> {
    if (typeof authorization !== 'string') return undefined;
    const [scheme, token, ...rest] = authorization.trim().split(/\s+/u);
    if (scheme?.toLowerCase() !== 'bearer' || !token || rest.length > 0) {
      return undefined;
    }
    try {
      const secret = this.secretFor(token);
      if (secret === undefined) return undefined;
      const payload = await this.jwtService.verifyAsync<{ sub?: unknown }>(
        token,
        { secret, algorithms: ['HS256'] },
      );
      return positiveUserId(payload.sub);
    } catch {
      return undefined;
    }
  }

  private secretFor(token: string): string | undefined {
    const decoded: unknown = this.jwtService.decode(token, { complete: true });
    const kid =
      typeof decoded === 'object' &&
      decoded !== null &&
      'header' in decoded &&
      typeof decoded.header === 'object' &&
      decoded.header !== null &&
      'kid' in decoded.header &&
      typeof decoded.header.kid === 'string'
        ? decoded.header.kid
        : this.configService.get<string>('jwt.activeKid');
    const secrets =
      this.configService.get<Record<string, unknown>>('jwt.secrets') ?? {};
    if (
      kid === undefined ||
      !Object.prototype.hasOwnProperty.call(secrets, kid)
    ) {
      return undefined;
    }
    const secret = secrets[kid];
    return typeof secret === 'string' ? secret : undefined;
  }
}

/**
 * Route-level tracker for anonymous auth endpoints (login, register). Keeps
 * them per client IP even when a bearer token is attached, so one IP cannot
 * multiply its budget by presenting tokens of several accounts.
 */
export function ipTracker(req: { ip?: string }): string {
  return `ip:${req.ip ?? 'unknown'}`;
}

function positiveUserId(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}
