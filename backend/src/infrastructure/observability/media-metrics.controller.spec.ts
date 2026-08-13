import { ForbiddenException } from '@nestjs/common';

import { MediaMetricsController } from './media-metrics.controller';

describe('MediaMetricsController', () => {
  it('requires an exact bearer token without reflecting it', async () => {
    const metrics = { render: jest.fn().mockResolvedValue('metric 1\n') };
    const config = {
      getOrThrow: jest.fn().mockReturnValue('m'.repeat(32)),
    };
    const controller = new MediaMetricsController(
      metrics as never,
      config as never,
    );
    expect(() => controller.scrape('Bearer wrong-secret')).toThrow(
      ForbiddenException,
    );
    expect(metrics.render).not.toHaveBeenCalled();
    await expect(controller.scrape(`Bearer ${'m'.repeat(32)}`)).resolves.toBe(
      'metric 1\n',
    );
  });
});
