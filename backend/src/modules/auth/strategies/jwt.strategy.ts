import { Injectable, UnauthorizedException } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

import { PassportStrategy } from '@nestjs/passport';

import { ExtractJwt, Strategy } from 'passport-jwt';

import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const jwtSecrets =
      configService.get<Record<string, string>>('jwt.secrets') ?? {};
    const activeKid = configService.get<string>('jwt.activeKid') ?? 'v1';

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),

      ignoreExpiration: false,
      secretOrKeyProvider: (
        _request: Request,
        rawJwtToken: string,
        done: (error: Error | null, secret?: string) => void,
      ) => {
        const kid = JwtStrategy.extractKid(rawJwtToken) ?? activeKid;
        const secret = jwtSecrets[kid];

        if (!secret) {
          done(new Error('Invalid JWT key id.'));
          return;
        }

        done(null, secret);
      },
    });
  }

  async validate(payload: { sub: number; email: string; role: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        deletedAt: true,
      },
    });

    if (!user || user.status !== 'active' || user.deletedAt !== null) {
      throw new UnauthorizedException('Account is not available.');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
    };
  }

  private static extractKid(rawJwtToken: string): string | null {
    try {
      const tokenSegments = rawJwtToken.split('.');
      if (tokenSegments.length !== 3) {
        return null;
      }

      const headerSegment = tokenSegments[0];
      const headerBuffer = Buffer.from(headerSegment, 'base64url');
      const headerJson = headerBuffer.toString('utf-8');
      const parsedHeader = JSON.parse(headerJson) as { kid?: string };

      return parsedHeader.kid ?? null;
    } catch {
      return null;
    }
  }
}
