import { Injectable } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

import { PassportStrategy } from '@nestjs/passport';

import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
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

  validate(payload: { sub: number; email: string; role: string }) {
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
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
