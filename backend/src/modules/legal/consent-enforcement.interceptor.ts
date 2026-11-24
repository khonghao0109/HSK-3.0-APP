import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';

import { ALLOW_WITHOUT_CONSENT_KEY } from './allow-without-consent.decorator';
import { ConsentService } from './consent.service';

export const CONSENT_REQUIRED = {
  code: 'CONSENT_REQUIRED',
  message: 'Accept the current terms and privacy policy to continue.',
};

/**
 * M1.7b2 (Q189): a learner past `effectiveAt` without consent may only call
 * routes marked `@AllowWithoutConsent()`. Runs after route guards, so
 * `request.user` is set exactly when the route authenticated a JWT; it throws
 * before `next.handle()`, so a blocked request never reaches its handler.
 */
@Injectable()
export class ConsentEnforcementInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly consentService: ConsentService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const user = context
      .switchToHttp()
      .getRequest<{ user?: { id: number; role: string } }>().user;
    if (user === undefined || user.role === 'admin') return next.handle();
    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_WITHOUT_CONSENT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowed === true) return next.handle();
    if (await this.consentService.hasBlockedDocument(user.id)) {
      throw new ForbiddenException(CONSENT_REQUIRED);
    }
    return next.handle();
  }
}
