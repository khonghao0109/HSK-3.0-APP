import { ServiceUnavailableException } from '@nestjs/common';

import { MediaIngestionEnabledGuard } from './media-ingestion-enabled.guard';

describe('MediaIngestionEnabledGuard', () => {
  it('rejects before multipart interception when disabled', () => {
    const complete = jest.fn();
    const metrics = {
      beginIngestionRequest: jest.fn(() => ({ complete })),
    };
    const guard = new MediaIngestionEnabledGuard(
      {
        get: jest.fn().mockReturnValue(false),
      } as never,
      metrics as never,
    );
    expect(() => guard.canActivate()).toThrow(ServiceUnavailableException);
    expect(metrics.beginIngestionRequest).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith('disabled');
  });

  it('permits the route only when explicitly enabled', () => {
    const metrics = { beginIngestionRequest: jest.fn() };
    const guard = new MediaIngestionEnabledGuard(
      {
        get: jest.fn().mockReturnValue(true),
      } as never,
      metrics as never,
    );
    expect(guard.canActivate()).toBe(true);
    expect(metrics.beginIngestionRequest).not.toHaveBeenCalled();
  });
});
