import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { CmsController } from './cms.controller';
import { MediaIngestionEnabledGuard } from './media-ingestion/media-ingestion-enabled.guard';

/**
 * TL-47: Express matches routes in declaration order, so the static
 * `GET media/ingestions` must be declared before `GET media/:mediaId`.
 */
function getRoutes(): string[] {
  return Object.getOwnPropertyNames(CmsController.prototype)
    .map(
      (name): unknown =>
        Object.getOwnPropertyDescriptor(CmsController.prototype, name)?.value,
    )
    .filter(
      (handler): handler is object =>
        typeof handler === 'function' &&
        Reflect.getMetadata(METHOD_METADATA, handler) === RequestMethod.GET,
    )
    .map((handler): string => Reflect.getMetadata(PATH_METADATA, handler));
}

describe('CmsController route order (TL-47)', () => {
  it('declares GET media/ingestions before GET media/:mediaId', () => {
    const routes = getRoutes();
    expect(routes).toContain('media/ingestions');
    expect(routes.indexOf('media/ingestions')).toBeLessThan(
      routes.indexOf('media/:mediaId'),
    );
  });

  it('does not gate the ingestion list on the ingestion flag', () => {
    const handler: unknown = Object.getOwnPropertyDescriptor(
      CmsController.prototype,
      'listMediaIngestions',
    )?.value;
    expect(typeof handler).toBe('function');
    const guards: unknown[] =
      Reflect.getMetadata('__guards__', handler as object) ?? [];
    expect(guards).not.toContain(MediaIngestionEnabledGuard);
  });
});
