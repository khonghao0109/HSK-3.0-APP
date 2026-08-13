import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { ObjectStoragePort } from '../../infrastructure/storage/object-storage.port';
import type { PrismaService } from '../../prisma/prisma.service';
import { createMediaAccessSignature } from './media-access-signature';
import { MediaAccessService } from './media-access.service';

describe('MediaAccessService storage-provider affinity', () => {
  const signingSecret = 's'.repeat(48);

  it.each([
    ['memory-test', 's3'],
    ['s3', 'memory-test'],
    ['s3', 'unknown-provider'],
  ])(
    'rejects createAccess before issuing a grant when adapter=%s and row=%s',
    async (adapterProvider, rowProvider) => {
      const { prisma, service, storage } = createFixture(
        adapterProvider,
        rowProvider,
      );

      await expect(
        service.createAccess({ id: 7, role: 'admin' }, 41),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.media.findUnique).toHaveBeenCalledTimes(1);
      expect(storage.getPrivateObject).not.toHaveBeenCalled();
    },
  );

  it('does not misclassify a missing media row as a provider mismatch', async () => {
    const { config, prisma, storage } = createFixture('s3', 's3');
    prisma.media.findUnique.mockResolvedValueOnce(null);
    const metrics = {
      recordSignedAccess: jest.fn(),
      recordStorage: jest.fn(),
    };
    const service = new MediaAccessService(
      prisma,
      config,
      storage,
      metrics as never,
    );

    await expect(
      service.createAccess({ id: 7, role: 'admin' }, 404),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(metrics.recordSignedAccess).not.toHaveBeenCalledWith(
      'provider_mismatch',
    );
    expect(metrics.recordStorage).not.toHaveBeenCalledWith(
      'get',
      'provider_mismatch',
      0,
    );
  });

  it.each([
    ['memory-test', 's3'],
    ['s3', 'memory-test'],
    ['s3', 'unknown-provider'],
  ])(
    'rejects signed reads before storage I/O when adapter=%s and row=%s',
    async (adapterProvider, rowProvider) => {
      const { service, storage } = createFixture(adapterProvider, rowProvider);
      const expiresAt = Math.floor(Date.now() / 1000) + 60;
      const signature = createMediaAccessSignature({
        mediaId: 41,
        expiresAt,
        checksum: 'a'.repeat(64),
        secret: signingSecret,
      });

      await expect(
        service.readSignedObject(41, expiresAt, signature),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(storage.getPrivateObject).not.toHaveBeenCalled();
    },
  );

  function createFixture(adapterProvider: string, rowProvider: string) {
    const findUnique = jest.fn().mockResolvedValue({
      id: 41,
      checksum: 'a'.repeat(64),
      mimeType: 'image/png',
      size: 8,
      storageProvider: rowProvider,
      storageKey: 'media/2026/08/018f43cb-9e6c-7f4e-8d23-8e8a0f8d5a9b.png',
      type: 'image',
      processingStatus: 'ready',
      deletedAt: null,
      lessonExercises: [],
    });
    const prisma = {
      media: { findUnique },
    } as unknown as PrismaService & {
      media: { findUnique: jest.Mock };
    };
    const config = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'media.signingSecret') return signingSecret;
        if (key === 'media.accessTtlSeconds') return 300;
        throw new Error(`Unexpected configuration key: ${key}`);
      }),
    } as unknown as ConfigService;
    const storage = {
      provider: adapterProvider,
      putPrivateObject: jest.fn(),
      privateObjectExists: jest.fn(),
      getPrivateObject: jest.fn(),
      deletePrivateObject: jest.fn(),
    } as unknown as ObjectStoragePort & {
      getPrivateObject: jest.Mock;
    };
    return {
      config,
      prisma,
      service: new MediaAccessService(prisma, config, storage),
      storage,
    };
  }
});
