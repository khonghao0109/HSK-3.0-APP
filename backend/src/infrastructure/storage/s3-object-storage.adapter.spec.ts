import { createHash } from 'node:crypto';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';

import { S3ObjectStorageAdapter } from './s3-object-storage.adapter';
import {
  MAX_PRIVATE_MEDIA_OBJECT_BYTES,
  ObjectStorageError,
  ObjectStorageWriteError,
} from './object-storage.port';

describe('S3ObjectStorageAdapter contract', () => {
  const body = Buffer.from('private-media-body');
  const checksum = createHash('sha256').update(body).digest('hex');

  it('writes a private encrypted object with trusted content metadata and timeout signal', async () => {
    const send = jest.fn().mockResolvedValue({});
    const adapter = createAdapter(send);

    await adapter.putPrivateObject({
      key: 'media/2026/08/opaque.png',
      body,
      contentType: 'image/png',
      checksum,
    });

    const [command, options] = send.mock.calls[0] as [
      PutObjectCommand,
      { abortSignal: AbortSignal },
    ];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'hsk-private-test',
      Key: 'media/2026/08/opaque.png',
      Body: body,
      ContentLength: body.length,
      ContentType: 'image/png',
      ChecksumSHA256: Buffer.from(checksum, 'hex').toString('base64'),
      ServerSideEncryption: 'AES256',
      Metadata: { sha256: checksum },
    });
    expect(command.input).not.toHaveProperty('ACL');
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('propagates definite and uncertain put failures for service compensation', async () => {
    const definite = createAdapter(
      jest.fn().mockRejectedValue(
        Object.assign(new Error('synthetic provider detail'), {
          name: 'AccessDenied',
        }),
      ),
    );
    await expect(
      definite.putPrivateObject({
        key: 'media/2026/08/definite.png',
        body,
        contentType: 'image/png',
        checksum,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        message: 'Private object storage write failed.',
        outcome: 'definite_not_written',
      }),
    );

    const uncertain = createAdapter(
      jest.fn().mockRejectedValue(
        Object.assign(new Error('socket reset'), {
          name: 'TimeoutError',
        }),
      ),
    );
    await expect(
      uncertain.putPrivateObject({
        key: 'media/2026/08/uncertain.png',
        body,
        contentType: 'image/png',
        checksum,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        message: 'Private object storage write failed.',
        outcome: 'unknown',
      }),
    );
  });

  it('aborts a storage request at the bounded adapter timeout', async () => {
    const send = jest.fn(
      (_command: PutObjectCommand, options: { abortSignal: AbortSignal }) =>
        new Promise((_, reject) => {
          options.abortSignal.addEventListener('abort', () => {
            reject(
              Object.assign(new Error('synthetic abort'), {
                name: 'AbortError',
              }),
            );
          });
        }),
    );
    const adapter = createAdapter(send, 10);

    await expect(
      adapter.putPrivateObject({
        key: 'media/2026/08/timeout.png',
        body,
        contentType: 'image/png',
        checksum,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: ObjectStorageWriteError.name,
        outcome: 'unknown',
      }),
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('enforces its deadline even when a client send ignores the abort signal', async () => {
    let requestSignal: AbortSignal | undefined;
    const send = jest.fn(
      (_command: PutObjectCommand, options: { abortSignal: AbortSignal }) => {
        requestSignal = options.abortSignal;
        return new Promise((resolve) => setTimeout(() => resolve({}), 80));
      },
    );
    const adapter = createAdapter(send, 15);

    await expect(
      adapter.putPrivateObject({
        key: 'media/2026/08/absolute-timeout.png',
        body,
        contentType: 'image/png',
        checksum,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: ObjectStorageWriteError.name,
        outcome: 'unknown',
      }),
    );

    expect(requestSignal?.aborted).toBe(true);
  });

  it('uses one absolute deadline across send and the entire response stream', async () => {
    let iteratorReturned = 0;
    const delayedBody = {
      [Symbol.asyncIterator]() {
        let emitted = false;
        return {
          async next() {
            if (emitted) return { done: true as const, value: undefined };
            emitted = true;
            await delay(35);
            return { done: false as const, value: body };
          },
          return() {
            iteratorReturned += 1;
            return Promise.resolve({ done: true as const, value: undefined });
          },
        };
      },
    };
    const send = jest.fn(async () => {
      await delay(10);
      return {
        Body: delayedBody,
        ContentType: 'image/png',
        ContentLength: body.length,
        Metadata: { sha256: checksum },
      };
    });
    const adapter = createAdapter(send, 25);

    await expect(
      adapter.getPrivateObject('media/2026/08/slow-stream.png'),
    ).rejects.toEqual(
      expect.objectContaining({
        name: ObjectStorageError.name,
        kind: 'unavailable',
      }),
    );

    expect(iteratorReturned).toBe(1);
  });

  it('cancels a response body that cannot produce the next chunk before deadline', async () => {
    const destroy = jest.fn();
    const delayedBody = {
      destroy,
      [Symbol.asyncIterator]() {
        let emitted = false;
        return {
          async next() {
            if (emitted) return { done: true as const, value: undefined };
            emitted = true;
            await delay(60);
            return { done: false as const, value: body };
          },
        };
      },
    };
    const adapter = createAdapter(
      jest.fn().mockResolvedValue({
        Body: delayedBody,
        ContentType: 'image/png',
        ContentLength: body.length,
        Metadata: { sha256: checksum },
      }),
      15,
    );

    await expect(
      adapter.getPrivateObject('media/2026/08/blocked-stream.png'),
    ).rejects.toEqual(expect.objectContaining({ kind: 'unavailable' }));
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('cancels a late GET body when client send resolves after the absolute deadline', async () => {
    const destroy = jest.fn();
    const adapter = createAdapter(
      jest.fn(async () => {
        await delay(40);
        return {
          Body: {
            destroy,
            [Symbol.asyncIterator]() {
              let emitted = false;
              return {
                next() {
                  if (emitted) {
                    return Promise.resolve({
                      done: true as const,
                      value: undefined,
                    });
                  }
                  emitted = true;
                  return Promise.resolve({ done: false as const, value: body });
                },
              };
            },
          },
          ContentType: 'image/png',
          ContentLength: body.length,
          Metadata: { sha256: checksum },
        };
      }),
      10,
    );

    await expect(
      adapter.getPrivateObject('media/2026/08/late-response.png'),
    ).rejects.toEqual(expect.objectContaining({ kind: 'unavailable' }));
    await delay(50);

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('returns an unread async iterator when metadata validation rejects the response', async () => {
    const iteratorReturn = jest
      .fn()
      .mockResolvedValue({ done: true as const, value: undefined });
    const responseBody = {
      [Symbol.asyncIterator]: jest.fn(() => ({
        next: jest.fn().mockResolvedValue({
          done: false as const,
          value: body,
        }),
        return: iteratorReturn,
      })),
    };
    const adapter = createAdapter(
      jest.fn().mockResolvedValue({
        Body: responseBody,
        ContentLength: body.length,
        Metadata: { sha256: checksum },
      }),
    );

    await expect(
      adapter.getPrivateObject('media/2026/08/malformed-metadata.png'),
    ).rejects.toEqual(expect.objectContaining({ kind: 'malformed_response' }));

    expect(responseBody[Symbol.asyncIterator]).toHaveBeenCalledTimes(1);
    expect(iteratorReturn).toHaveBeenCalledTimes(1);
  });

  it('cancels a body whose async iterator factory throws and returns a safe malformed response', async () => {
    const providerDetail = 'synthetic throwing iterator provider detail';
    const destroy = jest.fn();
    const iteratorFactory = jest.fn(() => {
      throw new Error(providerDetail);
    });
    const adapter = createAdapter(
      jest.fn().mockResolvedValue({
        Body: {
          destroy,
          [Symbol.asyncIterator]: iteratorFactory,
        },
        ContentType: 'image/png',
        ContentLength: body.length,
        Metadata: { sha256: checksum },
      }),
    );

    let thrown: unknown;
    try {
      await adapter.getPrivateObject('media/2026/08/throwing-iterator.png');
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toEqual(
      expect.objectContaining({
        kind: 'malformed_response',
        message: 'Private object storage response is malformed.',
      }),
    );
    expect(String(thrown)).not.toContain(providerDetail);
    expect(iteratorFactory).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('cancels an invalid iterator and invokes its return hook exactly once', async () => {
    const providerDetail = 'synthetic invalid iterator provider detail';
    const destroy = jest.fn();
    const iteratorReturn = jest
      .fn()
      .mockResolvedValue({ done: true as const, value: undefined });
    const iteratorFactory = jest.fn(() => ({
      return: iteratorReturn,
      providerDetail,
    }));
    const adapter = createAdapter(
      jest.fn().mockResolvedValue({
        Body: {
          destroy,
          [Symbol.asyncIterator]: iteratorFactory,
        },
        ContentType: 'image/png',
        ContentLength: body.length,
        Metadata: { sha256: checksum },
      }),
    );

    let thrown: unknown;
    try {
      await adapter.getPrivateObject('media/2026/08/invalid-iterator.png');
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toEqual(
      expect.objectContaining({
        kind: 'malformed_response',
        message: 'Private object storage response is malformed.',
      }),
    );
    expect(String(thrown)).not.toContain(providerDetail);
    expect(iteratorFactory).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(iteratorReturn).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      scenario: 'an integrity-violating oversized chunk',
      steps: [
        {
          done: false as const,
          value: Buffer.alloc(MAX_PRIVATE_MEDIA_OBJECT_BYTES + 1),
        },
      ],
    },
    {
      scenario: 'the successful end of a complete stream',
      steps: [
        { done: false as const, value: body },
        { done: true as const, value: undefined },
      ],
    },
  ])(
    'keeps deadline taxonomy and cleanup exact when it races $scenario',
    async ({ steps }) => {
      const iteratorReturn = jest
        .fn()
        .mockResolvedValue({ done: true as const, value: undefined });
      let requestSignal: AbortSignal | undefined;
      let stepIndex = 0;
      const next = jest.fn(() => {
        const step = steps[stepIndex];
        stepIndex += 1;
        if (stepIndex < steps.length) return Promise.resolve(step);
        return new Promise<(typeof steps)[number]>((resolve) => {
          requestSignal?.addEventListener('abort', () => resolve(step), {
            once: true,
          });
        });
      });
      const adapter = createAdapter(
        jest.fn(
          (
            _command: GetObjectCommand,
            options: { abortSignal: AbortSignal },
          ) => {
            requestSignal = options.abortSignal;
            return Promise.resolve({
              Body: {
                [Symbol.asyncIterator]: () => ({
                  next,
                  return: iteratorReturn,
                }),
              },
              ContentType: 'image/png',
              ContentLength: body.length,
              Metadata: { sha256: checksum },
            });
          },
        ),
        25,
      );

      await expect(
        adapter.getPrivateObject('media/2026/08/deadline-race.png'),
      ).rejects.toEqual(expect.objectContaining({ kind: 'unavailable' }));
      expect(requestSignal?.aborted).toBe(true);
      expect(iteratorReturn).toHaveBeenCalledTimes(1);
    },
  );

  it('clears a completed request deadline instead of aborting a retained signal later', async () => {
    let requestSignal: AbortSignal | undefined;
    const send = jest.fn(
      (_command: PutObjectCommand, options: { abortSignal: AbortSignal }) => {
        requestSignal = options.abortSignal;
        return Promise.resolve({});
      },
    );
    const adapter = createAdapter(send, 15);

    await adapter.putPrivateObject({
      key: 'media/2026/08/fast.png',
      body,
      contentType: 'image/png',
      checksum,
    });
    await delay(30);

    expect(requestSignal?.aborted).toBe(false);
  });

  it.each([
    ['missing body', { ContentType: 'image/png', ContentLength: body.length }],
    [
      'missing content type',
      { Body: stream(body), ContentLength: body.length },
    ],
    ['missing size', { Body: stream(body), ContentType: 'image/png' }],
    [
      'missing checksum',
      {
        Body: stream(body),
        ContentType: 'image/png',
        ContentLength: body.length,
      },
    ],
    [
      'oversized object',
      {
        Body: stream(body),
        ContentType: 'image/png',
        ContentLength: 10 * 1024 * 1024 + 1,
        Metadata: { sha256: checksum },
      },
    ],
  ])(
    'classifies %s with a safe typed response error',
    async (name, response) => {
      const adapter = createAdapter(jest.fn().mockResolvedValue(response));
      await expect(
        adapter.getPrivateObject('media/2026/08/opaque.png'),
      ).rejects.toEqual(
        expect.objectContaining({
          name: ObjectStorageError.name,
          kind:
            name === 'oversized object'
              ? 'integrity_violation'
              : 'malformed_response',
        }),
      );
    },
  );

  it('classifies malformed checksum metadata without reflecting it', async () => {
    const malformed = 'not-a-checksum-secret';
    const adapter = createAdapter(
      jest.fn().mockResolvedValue({
        Body: stream(body),
        ContentType: 'image/png',
        ContentLength: body.length,
        Metadata: { sha256: malformed },
      }),
    );
    await expect(
      adapter.getPrivateObject('media/2026/08/opaque.png'),
    ).rejects.toEqual(
      expect.objectContaining({
        kind: 'malformed_response',
        message: 'Private object storage response is malformed.',
      }),
    );
  });

  it('rejects body length and checksum mismatches', async () => {
    const wrongChecksum = createHash('sha256').update('wrong').digest('hex');
    const lengthMismatch = createAdapter(
      jest.fn().mockResolvedValue({
        Body: stream(body),
        ContentType: 'image/png',
        ContentLength: body.length + 1,
        Metadata: { sha256: checksum },
      }),
    );
    await expect(
      lengthMismatch.getPrivateObject('media/2026/08/opaque.png'),
    ).rejects.toEqual(expect.objectContaining({ kind: 'integrity_violation' }));

    const checksumMismatch = createAdapter(
      jest.fn().mockResolvedValue({
        Body: stream(body),
        ContentType: 'image/png',
        ContentLength: body.length,
        Metadata: { sha256: wrongChecksum },
      }),
    );
    await expect(
      checksumMismatch.getPrivateObject('media/2026/08/opaque.png'),
    ).rejects.toEqual(expect.objectContaining({ kind: 'integrity_violation' }));
  });

  it('bounds actual streamed bytes even when provider metadata understates size', async () => {
    const oversizedBody = Buffer.alloc(10 * 1024 * 1024 + 1, 0x41);
    const adapter = createAdapter(
      jest.fn().mockResolvedValue({
        Body: stream(oversizedBody),
        ContentType: 'image/png',
        ContentLength: 1,
        Metadata: { sha256: checksum },
      }),
    );

    await expect(
      adapter.getPrivateObject('media/2026/08/opaque.png'),
    ).rejects.toEqual(expect.objectContaining({ kind: 'integrity_violation' }));
  });

  it('classifies missing objects separately from provider outages', async () => {
    const missing = createAdapter(
      jest.fn().mockRejectedValue(
        Object.assign(new Error('synthetic provider detail'), {
          name: 'NoSuchKey',
          $metadata: { httpStatusCode: 404 },
        }),
      ),
    );
    await expect(
      missing.getPrivateObject('media/2026/08/missing.png'),
    ).rejects.toEqual(expect.objectContaining({ kind: 'not_found' }));

    const unavailable = createAdapter(
      jest.fn().mockRejectedValue(
        Object.assign(new Error('synthetic provider detail'), {
          name: 'TimeoutError',
        }),
      ),
    );
    await expect(
      unavailable.getPrivateObject('media/2026/08/unavailable.png'),
    ).rejects.toEqual(expect.objectContaining({ kind: 'unavailable' }));
  });

  it.each([
    ['NoSuchBucket', 404],
    ['AccessDenied', 404],
    ['NotFound', 404],
    ['NoSuchObject', 404],
    ['UnknownProviderError', 404],
    ['NoSuchKey', 403],
    ['SlowDown', 503],
    ['TimeoutError', undefined],
    ['NetworkingError', undefined],
  ])(
    'does not classify GET %s/%s as an absent object',
    async (name, httpStatusCode) => {
      const providerDetail = `provider-secret-${name}`;
      const adapter = createAdapter(
        jest.fn().mockRejectedValue(
          Object.assign(new Error(providerDetail), {
            name,
            ...(httpStatusCode === undefined
              ? {}
              : { $metadata: { httpStatusCode } }),
          }),
        ),
      );

      await expect(
        adapter.getPrivateObject('media/2026/08/private-key.png'),
      ).rejects.toEqual(
        expect.objectContaining({
          kind: 'unavailable',
          message: 'Private object storage is unavailable.',
        }),
      );
    },
  );

  it('issues a scoped delete and propagates delete failure without logging identity', async () => {
    const send = jest.fn().mockResolvedValueOnce({});
    const adapter = createAdapter(send);
    await adapter.deletePrivateObject('media/2026/08/opaque.png');
    const [command] = send.mock.calls[0] as [DeleteObjectCommand];
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'hsk-private-test',
      Key: 'media/2026/08/opaque.png',
    });

    const consoleError = jest.spyOn(console, 'error').mockImplementation();
    const failed = createAdapter(
      jest.fn().mockRejectedValue(new Error('synthetic delete failure')),
    );
    await expect(
      failed.deletePrivateObject('media/2026/08/secret-key.png'),
    ).rejects.toEqual(expect.objectContaining({ kind: 'unavailable' }));
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('uses GetObjectCommand for bounded reads', async () => {
    const send = jest.fn().mockResolvedValue({
      Body: stream(body),
      ContentType: 'image/png',
      ContentLength: body.length,
      Metadata: { sha256: checksum },
    });
    await expect(
      createAdapter(send).getPrivateObject('media/2026/08/opaque.png'),
    ).resolves.toMatchObject({
      body,
      contentType: 'image/png',
      checksum,
      size: body.length,
    });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
  });

  it('uses HeadObjectCommand to distinguish present, absent, and unknown state', async () => {
    const presentSend = jest.fn().mockResolvedValue({});
    await expect(
      createAdapter(presentSend).privateObjectExists(
        'media/2026/08/opaque.png',
      ),
    ).resolves.toBe(true);
    expect(presentSend.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);

    const absentSend = jest.fn().mockRejectedValue(
      Object.assign(new Error('provider detail'), {
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      }),
    );
    await expect(
      createAdapter(absentSend).privateObjectExists('media/2026/08/absent.png'),
    ).resolves.toBe(false);

    const unknownSend = jest
      .fn()
      .mockRejectedValue(new Error('synthetic connection failure'));
    await expect(
      createAdapter(unknownSend).privateObjectExists(
        'media/2026/08/unknown.png',
      ),
    ).rejects.toEqual(expect.objectContaining({ kind: 'unavailable' }));
  });

  it.each([
    ['NoSuchBucket', 404],
    ['AccessDenied', 404],
    ['NoSuchObject', 404],
    ['UnknownProviderError', 404],
    ['NotFound', 403],
    ['NoSuchKey', 403],
    ['SlowDown', 503],
    ['TimeoutError', undefined],
  ])(
    'keeps HEAD %s/%s unknown instead of reporting absence',
    async (name, httpStatusCode) => {
      const adapter = createAdapter(
        jest.fn().mockRejectedValue(
          Object.assign(new Error(`provider-secret-${name}`), {
            name,
            ...(httpStatusCode === undefined
              ? {}
              : { $metadata: { httpStatusCode } }),
          }),
        ),
      );

      await expect(
        adapter.privateObjectExists('media/2026/08/private-key.png'),
      ).rejects.toEqual(
        expect.objectContaining({
          kind: 'unavailable',
          message: 'Private object storage is unavailable.',
        }),
      );
    },
  );

  it.each([
    ['NoSuchKey', 404],
    ['NotFound', 404],
  ])(
    'accepts only the HEAD object-not-found contract %s/%s as absence',
    async (name, httpStatusCode) => {
      const adapter = createAdapter(
        jest.fn().mockRejectedValue(
          Object.assign(new Error('synthetic object absence'), {
            name,
            $metadata: { httpStatusCode },
          }),
        ),
      );
      await expect(
        adapter.privateObjectExists('media/2026/08/absent.png'),
      ).resolves.toBe(false);
    },
  );

  it('maps a streamed provider failure to typed unavailable without leaking detail', async () => {
    const providerDetail = 'stream-provider-secret';
    const failingBody = Readable.from(
      (function* () {
        yield body.subarray(0, 3);
        throw new Error(providerDetail);
      })(),
    );
    const adapter = createAdapter(
      jest.fn().mockResolvedValue({
        Body: failingBody,
        ContentType: 'image/png',
        ContentLength: body.length,
        Metadata: { sha256: checksum },
      }),
    );

    let thrown: unknown;
    try {
      await adapter.getPrivateObject('media/2026/08/private-key.png');
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toEqual(
      expect.objectContaining({
        kind: 'unavailable',
        message: 'Private object storage is unavailable.',
      }),
    );
    expect(String(thrown)).not.toContain(providerDetail);
  });
});

function createAdapter(send: jest.Mock, requestTimeoutMs = 8_000) {
  const config = {
    getOrThrow: (key: string) => {
      if (key === 'media.bucket') return 'hsk-private-test';
      if (key === 'media.region') return 'ap-southeast-1';
      throw new Error(`Unexpected config key: ${key}`);
    },
    get: () => undefined,
  } as unknown as ConfigService;
  return new S3ObjectStorageAdapter(
    config,
    { send } as unknown as S3Client,
    requestTimeoutMs,
  );
}

function stream(value: Buffer) {
  return Readable.from([value]);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
