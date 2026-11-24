import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';

import { ALLOW_WITHOUT_CONSENT_KEY } from './allow-without-consent.decorator';
import { ConsentEnforcementInterceptor } from './consent-enforcement.interceptor';

function contextFor(
  user: { id: number; role: string } | undefined,
  allowed = false,
): ExecutionContext {
  const handler = () => undefined;
  if (allowed) Reflect.defineMetadata(ALLOW_WITHOUT_CONSENT_KEY, true, handler);
  class Target {}
  return {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => Target,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

describe('ConsentEnforcementInterceptor', () => {
  const hasBlockedDocument = jest.fn<Promise<boolean>, [number]>();
  const handle = jest.fn(() => of('handled'));
  const next: CallHandler = { handle };
  const interceptor = new ConsentEnforcementInterceptor(new Reflector(), {
    hasBlockedDocument,
  } as never);

  beforeEach(() => {
    hasBlockedDocument.mockReset();
    handle.mockClear();
  });

  const run = async (context: ExecutionContext) =>
    lastValueFrom(await interceptor.intercept(context, next));

  it('passes requests without an authenticated user untouched', async () => {
    await expect(run(contextFor(undefined))).resolves.toBe('handled');
    expect(hasBlockedDocument).not.toHaveBeenCalled();
  });

  it('never checks admins', async () => {
    await expect(run(contextFor({ id: 1, role: 'admin' }))).resolves.toBe(
      'handled',
    );
    expect(hasBlockedDocument).not.toHaveBeenCalled();
  });

  it('never checks allowlisted routes', async () => {
    await expect(run(contextFor({ id: 2, role: 'user' }, true))).resolves.toBe(
      'handled',
    );
    expect(hasBlockedDocument).not.toHaveBeenCalled();
  });

  it('lets a learner through when nothing is blocked', async () => {
    hasBlockedDocument.mockResolvedValue(false);
    await expect(run(contextFor({ id: 3, role: 'user' }))).resolves.toBe(
      'handled',
    );
    expect(hasBlockedDocument).toHaveBeenCalledWith(3);
  });

  it('rejects a blocked learner with CONSENT_REQUIRED before the handler', async () => {
    hasBlockedDocument.mockResolvedValue(true);
    const error = await run(contextFor({ id: 4, role: 'user' })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      code: 'CONSENT_REQUIRED',
    });
    expect(handle).not.toHaveBeenCalled();
  });
});
