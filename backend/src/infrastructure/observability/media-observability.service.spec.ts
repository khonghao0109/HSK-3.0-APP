import { ServiceUnavailableException } from '@nestjs/common';

import {
  assertMediaIngestionEnabled,
  MediaObservabilityService,
} from './media-observability.service';

describe('media operations controls and metrics', () => {
  it('fails closed when the ingestion kill switch is disabled', () => {
    expect(() => assertMediaIngestionEnabled(false)).toThrow(
      ServiceUnavailableException,
    );
  });

  it('emits bounded Prometheus labels and never raw media identity', async () => {
    const prisma = {
      mediaIngestion: {
        count: jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(1),
        aggregate: jest
          .fn()
          .mockResolvedValueOnce({ _min: { updatedAt: new Date(0) } })
          .mockResolvedValueOnce({ _min: { updatedAt: new Date(0) } }),
      },
    };
    const metrics = new MediaObservabilityService(prisma as never);
    metrics.recordIngestion('success');
    metrics.recordStorage('put', 'success', 23);
    metrics.recordStorage('get', 'provider_mismatch', 0);
    metrics.recordScanner('unavailable', 12);
    metrics.recordSignedAccess('invalid_grant');

    const output = await metrics.render();

    expect(output).toContain('hsk_media_ingestion_total{outcome="success"} 1');
    expect(output).toContain(
      'hsk_media_storage_operations_total{operation="put",outcome="success"} 1',
    );
    expect(output).toContain('hsk_media_cleanup_required 2');
    expect(output).toContain('hsk_media_stuck_processing 1');
    expect(output).not.toMatch(/mediaId|storageKey|filename|signature|@/u);
  });

  it('rejects unbounded labels instead of serializing them', () => {
    const metrics = new MediaObservabilityService({} as never);
    expect(() =>
      metrics.recordStorage('put', 'secret-object-key' as never, 1),
    ).toThrow('Unsupported media metric label');
  });
});
