import { ServiceUnavailableException } from '@nestjs/common';

import { MediaIngestionEnabledGuard } from './media-ingestion-enabled.guard';

describe('MediaIngestionEnabledGuard', () => {
  it('rejects before multipart interception when disabled', () => {
    const guard = new MediaIngestionEnabledGuard({
      get: jest.fn().mockReturnValue(false),
    } as never);
    expect(() => guard.canActivate()).toThrow(ServiceUnavailableException);
  });

  it('permits the route only when explicitly enabled', () => {
    const guard = new MediaIngestionEnabledGuard({
      get: jest.fn().mockReturnValue(true),
    } as never);
    expect(guard.canActivate()).toBe(true);
  });
});
