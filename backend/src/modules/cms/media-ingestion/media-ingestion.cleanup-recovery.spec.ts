import { ConflictException, ServiceUnavailableException } from '@nestjs/common';

import { MediaIngestionService } from './media-ingestion.service';

describe('MediaIngestionService cleanup claim recovery', () => {
  it('returns a claimed row to retryable cleanup when ownership verification fails', async () => {
    const fixture = createFixture();
    fixture.claimCleanup.mockResolvedValue(claimed());
    fixture.ownsProcessingAttempt.mockRejectedValue(
      Object.assign(new Error('synthetic database connection detail'), {
        code: 'P1001',
      }),
    );
    fixture.recordCleanupFailure.mockResolvedValue(undefined);

    const result = await settle(
      fixture.service.retryCleanup(actor, 41, context),
    );

    expect(result.status).toBe('rejected');
    expectSafeCode(result, 'MEDIA_CLEANUP_REQUIRED');
    expect(fixture.recordCleanupFailure).toHaveBeenCalledTimes(1);
    expect(fixture.storage.privateObjectExists).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('synthetic database');
  });

  it('reconciles a committed recovery write after its acknowledgement is lost', async () => {
    const fixture = createFixture();
    fixture.claimCleanup.mockResolvedValue(claimed());
    fixture.ownsProcessingAttempt.mockRejectedValue(
      Object.assign(new Error('synthetic ownership read failure'), {
        code: 'P1001',
      }),
    );
    fixture.recordCleanupFailure.mockRejectedValue(
      Object.assign(new Error('synthetic recovery acknowledgement loss'), {
        code: 'P1001',
      }),
    );
    fixture.readIngestionState.mockResolvedValue(
      claimed({
        status: 'cleanup_required',
        failureCode: 'OBJECT_CLEANUP_REQUIRED',
      }),
    );

    const result = await settle(
      fixture.service.retryCleanup(actor, 41, context),
    );

    expectSafeCode(result, 'MEDIA_CLEANUP_REQUIRED');
    expect(fixture.storage.privateObjectExists).not.toHaveBeenCalled();
  });

  it('fails with a sanitized unknown outcome when neither recovery write nor reread is available', async () => {
    const fixture = createFixture();
    fixture.claimCleanup.mockResolvedValue(claimed());
    fixture.ownsProcessingAttempt.mockRejectedValue(
      Object.assign(new Error('raw ownership provider detail'), {
        code: 'P1001',
      }),
    );
    fixture.recordCleanupFailure.mockRejectedValue(
      Object.assign(new Error('raw recovery provider detail'), {
        code: 'P1001',
      }),
    );
    fixture.readIngestionState.mockResolvedValue(undefined);

    const result = await settle(
      fixture.service.retryCleanup(actor, 41, context),
    );

    expectSafeCode(result, 'MEDIA_CLEANUP_OUTCOME_UNKNOWN');
    expect(JSON.stringify(result)).not.toMatch(/raw ownership|raw recovery/u);
  });

  it('sanitizes a failed authoritative reread after recovery acknowledgement is lost', async () => {
    const fixture = createFixture();
    fixture.claimCleanup.mockResolvedValue(claimed());
    fixture.ownsProcessingAttempt.mockRejectedValue(
      Object.assign(new Error('raw ownership provider detail'), {
        code: 'P1001',
      }),
    );
    fixture.recordCleanupFailure.mockRejectedValue(
      Object.assign(new Error('raw recovery provider detail'), {
        code: 'P1001',
      }),
    );
    fixture.readIngestionState.mockRejectedValue(
      Object.assign(new Error('raw authoritative reread detail'), {
        code: 'P1001',
      }),
    );

    const result = await settle(
      fixture.service.retryCleanup(actor, 41, context),
    );

    expectSafeCode(result, 'MEDIA_CLEANUP_OUTCOME_UNKNOWN');
    expect(JSON.stringify(result)).not.toMatch(
      /raw ownership|raw recovery|raw authoritative/u,
    );
  });

  it('sanitizes a failed authoritative reread after a lost claim acknowledgement', async () => {
    const fixture = createFixture();
    fixture.claimCleanup.mockRejectedValue(
      Object.assign(new Error('raw claim provider detail'), {
        code: 'P1001',
      }),
    );
    fixture.readIngestionState.mockRejectedValue(
      Object.assign(new Error('raw claim reread detail'), {
        code: 'P1001',
      }),
    );

    const result = await settle(
      fixture.service.retryCleanup(actor, 41, context),
    );

    expectSafeCode(result, 'MEDIA_CLEANUP_OUTCOME_UNKNOWN');
    expect(JSON.stringify(result)).not.toMatch(/raw claim/u);
  });

  it('does not take over when ownership changed after a successful claim', async () => {
    const fixture = createFixture();
    fixture.claimCleanup.mockResolvedValue(claimed());
    fixture.ownsProcessingAttempt.mockResolvedValue(false);

    const result = await settle(
      fixture.service.retryCleanup(actor, 41, context),
    );

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toBeInstanceOf(ConflictException);
    }
    expect(fixture.recordCleanupFailure).not.toHaveBeenCalled();
    expect(fixture.storage.privateObjectExists).not.toHaveBeenCalled();
  });

  it('classifies a readable retryable row as a claim that certainly did not remain committed', async () => {
    const fixture = createFixture();
    fixture.claimCleanup.mockRejectedValue(
      Object.assign(new Error('synthetic lost claim acknowledgement'), {
        code: 'P1001',
      }),
    );
    fixture.readIngestionState.mockResolvedValue(
      claimed({
        status: 'cleanup_required',
        processingToken: 'previous-token',
        failureCode: 'OBJECT_CLEANUP_REQUIRED',
      }),
    );

    const result = await settle(
      fixture.service.retryCleanup(actor, 41, context),
    );

    expectSafeCode(result, 'MEDIA_CLEANUP_REQUIRED');
    expect(fixture.ownsProcessingAttempt).not.toHaveBeenCalled();
    expect(fixture.storage.privateObjectExists).not.toHaveBeenCalled();
  });

  it('continues only when a lost claim acknowledgement is authoritatively owned by this request', async () => {
    const fixture = createFixture();
    fixture.claimCleanup.mockImplementation(
      (_actorId: number, _ingestionId: number, token: string) => {
        fixture.captureRequestToken(token);
        return Promise.reject(
          Object.assign(new Error('synthetic lost claim acknowledgement'), {
            code: 'P1001',
          }),
        );
      },
    );
    fixture.readIngestionState.mockImplementation(() =>
      Promise.resolve(claimed({ processingToken: fixture.requestToken })),
    );
    fixture.ownsProcessingAttempt.mockResolvedValue(true);
    fixture.ensureCleanupDeferred.mockResolvedValue(undefined);
    fixture.storage.privateObjectExists.mockResolvedValue(false);
    fixture.storage.deletePrivateObject.mockResolvedValue(undefined);

    await expect(
      fixture.service.retryCleanup(actor, 41, context),
    ).resolves.toMatchObject({
      data: { cleanupCompleted: false, settling: true },
    });
    expect(fixture.storage.privateObjectExists).toHaveBeenCalledTimes(2);
    expect(fixture.storage.deletePrivateObject).toHaveBeenCalledTimes(1);
  });
});

const actor = { id: 7, role: 'admin' };
const context = { correlationId: 'synthetic-correlation' };

function createFixture() {
  const storage = {
    provider: 's3',
    privateObjectExists: jest.fn(),
    deletePrivateObject: jest.fn(),
  };
  const service = new MediaIngestionService(
    {} as never,
    {} as never,
    storage as never,
    {} as never,
  );
  const requestToken = 'request-token';
  const privateService = service as unknown as {
    claimCleanup: jest.Mock;
    ownsProcessingAttempt: jest.Mock;
    recordCleanupFailure: jest.Mock;
    readIngestionState: jest.Mock;
    ensureCleanupDeferred: jest.Mock;
  };
  let capturedToken = requestToken;
  privateService.claimCleanup = jest.fn(
    (_actorId: number, _ingestionId: number, token: string) => {
      capturedToken = token;
      return Promise.resolve(claimed({ processingToken: token }));
    },
  );
  privateService.ownsProcessingAttempt = jest.fn();
  privateService.recordCleanupFailure = jest.fn();
  privateService.readIngestionState = jest.fn();
  privateService.ensureCleanupDeferred = jest.fn();
  return {
    service,
    storage,
    get requestToken() {
      return capturedToken;
    },
    captureRequestToken(token: string) {
      capturedToken = token;
    },
    ...privateService,
  };
}

function claimed(overrides: Record<string, unknown> = {}) {
  return {
    id: 41,
    status: 'processing',
    processingToken: 'request-token',
    failureCode: 'OBJECT_CLEANUP_IN_PROGRESS',
    storageProvider: 's3',
    storageKey: 'synthetic-private-key',
    cleanupAbsentObservedAt: null,
    ...overrides,
  } as never;
}

async function settle<T>(promise: Promise<T>) {
  try {
    return { status: 'fulfilled' as const, value: await promise };
  } catch (reason: unknown) {
    return { status: 'rejected' as const, reason };
  }
}

function expectSafeCode(
  result: Awaited<ReturnType<typeof settle>>,
  code: string,
): void {
  expect(result.status).toBe('rejected');
  if (result.status !== 'rejected') return;
  expect(result.reason).toBeInstanceOf(ServiceUnavailableException);
  expect((result.reason as ServiceUnavailableException).getResponse()).toEqual({
    code,
    message:
      code === 'MEDIA_CLEANUP_REQUIRED'
        ? 'Media cleanup is temporarily unavailable.'
        : 'Media cleanup outcome requires reconciliation.',
  });
}
