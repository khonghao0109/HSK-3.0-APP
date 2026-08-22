import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

import type { ObjectStoragePort } from '../../infrastructure/storage/object-storage.port';
import { ObjectStorageError } from '../../infrastructure/storage/object-storage.port';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  createMediaAccessSignature,
  verifyMediaAccessSignature,
} from './media-access-signature';
import { MediaAccessService } from './media-access.service';

describe('MediaAccessService storage-provider affinity', () => {
  const signingSecret = 's'.repeat(48);
  const canonicalRequestTarget = {
    method: 'GET',
    path: '/api/v1/media/41/content',
  };
  const canonicalSignatureTarget = {
    method: canonicalRequestTarget.method,
    resource: canonicalRequestTarget.path,
  };

  afterEach(() => jest.restoreAllMocks());

  it('starts signed-content accounting before the database boundary and settles unavailable once', async () => {
    const { config, prisma, storage } = createFixture('s3', 's3');
    const complete = jest.fn();
    const metrics = {
      beginSignedContentRequest: jest.fn(() => ({ complete })),
      recordSignedAccess: jest.fn(),
    };
    prisma.media.findUnique.mockRejectedValueOnce(
      new Error('synthetic database outage'),
    );
    const service = new MediaAccessService(
      prisma,
      config,
      storage,
      metrics as never,
    );

    await expect(
      service.readSignedObject(
        41,
        1,
        'synthetic-signature',
        canonicalRequestTarget,
      ),
    ).rejects.toThrow('synthetic database outage');

    expect(metrics.beginSignedContentRequest).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith('unavailable');
  });

  it('issues a grant bound to the canonical GET content resource', async () => {
    const { service } = createFixture('s3', 's3');
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    const result = await service.createAccess({ id: 7, role: 'admin' }, 41);
    const url = new URL(result.data.url, 'https://app.example.test');
    const expiresAt = Number(url.searchParams.get('expires'));
    const signature = url.searchParams.get('signature') ?? '';

    expect(url.pathname).toBe(canonicalRequestTarget.path);
    expect(expiresAt).toBe(1_700_000_300);
    expect(
      verifyMediaAccessSignature(
        {
          mediaId: 41,
          expiresAt,
          checksum: 'a'.repeat(64),
          signature,
          secret: signingSecret,
          ...canonicalSignatureTarget,
        },
        1_700_000_000,
      ),
    ).toBe(true);
  });

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

  it.each([
    ['HEAD method', { method: 'HEAD', path: '/api/v1/media/41/content' }],
    ['trailing slash', { method: 'GET', path: '/api/v1/media/41/content/' }],
    ['mixed case', { method: 'GET', path: '/API/v1/media/41/content' }],
    ['duplicate slash', { method: 'GET', path: '/api/v1/media//41/content' }],
    [
      'path parameter',
      { method: 'GET', path: '/api/v1/media/41/content;download' },
    ],
    [
      'encoded separator',
      { method: 'GET', path: '/api/v1/media%2F41/content' },
    ],
  ])(
    'rejects a canonical GET signature reused with %s before object I/O',
    async (_, requestTarget) => {
      const { service, storage } = createFixture('s3', 's3');
      const expiresAt = Math.floor(Date.now() / 1000) + 60;
      const signature = createMediaAccessSignature({
        mediaId: 41,
        expiresAt,
        checksum: 'a'.repeat(64),
        secret: signingSecret,
        ...canonicalSignatureTarget,
      });

      await expect(
        service.readSignedObject(41, expiresAt, signature, requestTarget),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(storage.getPrivateObject).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['not_found', 'not_found'],
    ['malformed_response', 'malformed_response'],
    ['integrity_violation', 'integrity_error'],
  ] as const)(
    'records %s reads as integrity failure instead of provider outage',
    async (kind, storageOutcome) => {
      const { config, prisma, storage } = createFixture('s3', 's3');
      const metrics = createMetrics();
      storage.getPrivateObject.mockRejectedValueOnce(
        new ObjectStorageError(kind),
      );
      const service = new MediaAccessService(
        prisma,
        config,
        storage,
        metrics as never,
      );
      const expiresAt = Math.floor(Date.now() / 1000) + 60;
      const signature = createMediaAccessSignature({
        mediaId: 41,
        expiresAt,
        checksum: 'a'.repeat(64),
        secret: signingSecret,
        ...canonicalSignatureTarget,
      });

      await expect(
        service.readSignedObject(
          41,
          expiresAt,
          signature,
          canonicalRequestTarget,
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(metrics.recordStorage).toHaveBeenCalledWith(
        'get',
        storageOutcome,
        expect.any(Number),
      );
      expect(metrics.recordSignedAccess).toHaveBeenCalledWith(
        'integrity_error',
      );
      expect(metrics.recordReconciliation).toHaveBeenCalledWith('violation');
      expect(metrics.recordSignedAccess).not.toHaveBeenCalledWith(
        'unavailable',
      );
    },
  );

  it('keeps a real provider outage classified as unavailable', async () => {
    const { config, prisma, storage } = createFixture('s3', 's3');
    const metrics = createMetrics();
    storage.getPrivateObject.mockRejectedValueOnce(
      new ObjectStorageError('unavailable'),
    );
    const service = new MediaAccessService(
      prisma,
      config,
      storage,
      metrics as never,
    );
    const expiresAt = Math.floor(Date.now() / 1000) + 60;
    const signature = createMediaAccessSignature({
      mediaId: 41,
      expiresAt,
      checksum: 'a'.repeat(64),
      secret: signingSecret,
      ...canonicalSignatureTarget,
    });

    await expect(
      service.readSignedObject(
        41,
        expiresAt,
        signature,
        canonicalRequestTarget,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(metrics.recordStorage).toHaveBeenCalledWith(
      'get',
      'error',
      expect.any(Number),
    );
    expect(metrics.recordSignedAccess).toHaveBeenCalledWith('unavailable');
    expect(metrics.recordReconciliation).not.toHaveBeenCalled();
  });

  it('keeps an adapter-reported provider mismatch distinct from corruption', async () => {
    const { config, prisma, storage } = createFixture('s3', 's3');
    const metrics = createMetrics();
    storage.getPrivateObject.mockRejectedValueOnce(
      new ObjectStorageError('provider_mismatch'),
    );
    const service = new MediaAccessService(
      prisma,
      config,
      storage,
      metrics as never,
    );
    const expiresAt = Math.floor(Date.now() / 1000) + 60;
    const signature = createMediaAccessSignature({
      mediaId: 41,
      expiresAt,
      checksum: 'a'.repeat(64),
      secret: signingSecret,
      ...canonicalSignatureTarget,
    });

    await expect(
      service.readSignedObject(
        41,
        expiresAt,
        signature,
        canonicalRequestTarget,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(metrics.recordStorage).toHaveBeenCalledWith(
      'get',
      'provider_mismatch',
      expect.any(Number),
    );
    expect(metrics.recordSignedAccess).toHaveBeenCalledWith(
      'provider_mismatch',
    );
    expect(metrics.recordReconciliation).toHaveBeenCalledWith('violation');
  });

  it('classifies database/object MIME and size mismatch as integrity failure', async () => {
    const body = Buffer.from('different');
    const checksum = createHash('sha256').update(body).digest('hex');
    const { config, prisma, storage } = createFixture('s3', 's3', {
      checksum,
      mimeType: 'image/png',
      size: body.length - 1,
    });
    const metrics = createMetrics();
    storage.getPrivateObject.mockResolvedValueOnce({
      body,
      checksum,
      contentType: 'audio/mpeg',
      size: body.length,
    });
    const service = new MediaAccessService(
      prisma,
      config,
      storage,
      metrics as never,
    );
    const expiresAt = Math.floor(Date.now() / 1000) + 60;
    const signature = createMediaAccessSignature({
      mediaId: 41,
      expiresAt,
      checksum,
      secret: signingSecret,
      ...canonicalSignatureTarget,
    });

    await expect(
      service.readSignedObject(
        41,
        expiresAt,
        signature,
        canonicalRequestTarget,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(metrics.recordSignedAccess).toHaveBeenCalledWith('integrity_error');
    expect(metrics.recordReconciliation).toHaveBeenCalledWith('violation');
  });

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
        ...canonicalSignatureTarget,
      });

      await expect(
        service.readSignedObject(
          41,
          expiresAt,
          signature,
          canonicalRequestTarget,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(storage.getPrivateObject).not.toHaveBeenCalled();
    },
  );

  function createFixture(
    adapterProvider: string,
    rowProvider: string,
    rowOverrides: Partial<{
      checksum: string;
      mimeType: string;
      size: number;
    }> = {},
  ) {
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
      ...rowOverrides,
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

  function createMetrics() {
    const complete = jest.fn();
    return {
      beginSignedContentRequest: jest.fn(() => ({ complete })),
      recordSignedAccess: jest.fn(),
      recordStorage: jest.fn(),
      recordReconciliation: jest.fn(),
      complete,
    };
  }
});
