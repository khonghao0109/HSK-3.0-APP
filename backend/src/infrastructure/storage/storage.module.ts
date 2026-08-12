import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { InMemoryObjectStorageAdapter } from './in-memory-object-storage.adapter';
import { OBJECT_STORAGE } from './object-storage.port';
import { S3ObjectStorageAdapter } from './s3-object-storage.adapter';

@Module({
  providers: [
    InMemoryObjectStorageAdapter,
    {
      provide: OBJECT_STORAGE,
      useFactory: (
        memory: InMemoryObjectStorageAdapter,
        config: ConfigService,
      ) => createObjectStorageAdapter(process.env.NODE_ENV, memory, config),
      inject: [InMemoryObjectStorageAdapter, ConfigService],
    },
  ],
  exports: [OBJECT_STORAGE, InMemoryObjectStorageAdapter],
})
export class StorageModule {}

export function createObjectStorageAdapter(
  nodeEnv: string | undefined,
  memory: InMemoryObjectStorageAdapter,
  config: ConfigService,
) {
  return nodeEnv === 'test' ? memory : new S3ObjectStorageAdapter(config);
}
