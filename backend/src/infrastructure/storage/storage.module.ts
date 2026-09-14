import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { InMemoryObjectStorageAdapter } from './in-memory-object-storage.adapter';
import { OBJECT_STORAGE, type ObjectStoragePort } from './object-storage.port';
import { S3ObjectStorageAdapter } from './s3-object-storage.adapter';

@Module({
  providers: [
    InMemoryObjectStorageAdapter,
    {
      provide: OBJECT_STORAGE,
      useFactory: (
        memory: InMemoryObjectStorageAdapter,
        config: ConfigService,
      ) => createObjectStorageAdapter(memory, config),
      inject: [InMemoryObjectStorageAdapter, ConfigService],
    },
  ],
  exports: [OBJECT_STORAGE, InMemoryObjectStorageAdapter],
})
export class StorageModule {}

/**
 * Selects the adapter named by MEDIA_STORAGE_PROVIDER. Config validation only
 * accepts `memory` under NODE_ENV=test; an unknown value fails the boot.
 */
export function createObjectStorageAdapter(
  memory: InMemoryObjectStorageAdapter,
  config: ConfigService,
): ObjectStoragePort {
  const provider = config.getOrThrow<string>('media.storageProvider');
  if (provider === 's3') return new S3ObjectStorageAdapter(config);
  if (provider === 'memory') return memory;
  throw new Error('Unsupported media storage provider.');
}
