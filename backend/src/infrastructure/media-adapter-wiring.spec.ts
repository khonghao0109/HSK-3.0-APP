import { ConfigService } from '@nestjs/config';

import { ClamavMediaMalwareScanner } from './malware/clamav-media-malware-scanner';
import { createMediaMalwareScanner } from './malware/malware.module';
import { TestMediaMalwareScanner } from './malware/test-media-malware-scanner';
import { InMemoryObjectStorageAdapter } from './storage/in-memory-object-storage.adapter';
import { S3ObjectStorageAdapter } from './storage/s3-object-storage.adapter';
import { createObjectStorageAdapter } from './storage/storage.module';

describe('production media adapter wiring', () => {
  const memory = new InMemoryObjectStorageAdapter();
  const scanner = new TestMediaMalwareScanner();
  const config = {
    getOrThrow: (key: string) => {
      const values: Record<string, string | number> = {
        'media.bucket': 'hsk-private-test',
        'media.region': 'ap-southeast-1',
        'media.scannerHost': 'clamav.internal',
        'media.scannerPort': 3310,
      };
      if (!(key in values)) throw new Error(`Missing config ${key}`);
      return values[key];
    },
    get: () => undefined,
  } as unknown as ConfigService;

  it('uses deliberate test doubles only in NODE_ENV=test', () => {
    expect(createObjectStorageAdapter('test', memory, config)).toBe(memory);
    expect(createMediaMalwareScanner('test', scanner, config)).toBe(scanner);
  });

  it('uses S3 and ClamAV for development and production', () => {
    expect(
      createObjectStorageAdapter('production', memory, config),
    ).toBeInstanceOf(S3ObjectStorageAdapter);
    expect(
      createMediaMalwareScanner('production', scanner, config),
    ).toBeInstanceOf(ClamavMediaMalwareScanner);
    expect(
      createObjectStorageAdapter('development', memory, config),
    ).toBeInstanceOf(S3ObjectStorageAdapter);
  });
});
