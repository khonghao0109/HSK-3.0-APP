import { createHash } from 'node:crypto';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';

import { S3ObjectStorageAdapter } from './s3-object-storage.adapter';
import { ObjectStorageWriteError } from './object-storage.port';

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
  ])('rejects %s responses', async (_, response) => {
    const adapter = createAdapter(jest.fn().mockResolvedValue(response));
    await expect(
      adapter.getPrivateObject('media/2026/08/opaque.png'),
    ).rejects.toThrow();
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
    ).rejects.toThrow('integrity');

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
    ).rejects.toThrow('integrity');
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
    ).rejects.toThrow('maximum size');
  });

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
    ).rejects.toThrow('synthetic delete failure');
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
