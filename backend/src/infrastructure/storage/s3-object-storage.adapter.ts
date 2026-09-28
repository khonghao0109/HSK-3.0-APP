import {
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

import {
  MAX_PRIVATE_MEDIA_OBJECT_BYTES,
  ObjectStorageError,
  ObjectStorageWriteError,
  ObjectStorageWriteOutcome,
  ObjectStoragePort,
  StoredObject,
} from './object-storage.port';

export const S3_CLIENT_OVERRIDE = Symbol('S3_CLIENT_OVERRIDE');

@Injectable()
export class S3ObjectStorageAdapter implements ObjectStoragePort {
  readonly provider = 's3';
  private readonly bucket: string;
  private readonly client: S3Client;
  private readonly requestTimeoutMs: number;

  constructor(
    config: ConfigService,
    @Optional() @Inject(S3_CLIENT_OVERRIDE) clientOverride?: S3Client,
    requestTimeoutMs = 8_000,
  ) {
    this.bucket = config.getOrThrow<string>('media.bucket');
    this.client =
      clientOverride ??
      new S3Client({
        region: config.getOrThrow<string>('media.region'),
        ...(config.get<string>('media.endpoint')
          ? {
              endpoint: config.getOrThrow<string>('media.endpoint'),
              forcePathStyle: true,
            }
          : {}),
        maxAttempts: 2,
      });
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async putPrivateObject(input: {
    key: string;
    body: Buffer;
    contentType: string;
    checksum: string;
  }): Promise<void> {
    const deadline = new StorageOperationDeadline(this.requestTimeoutMs);
    try {
      await deadline.race(
        this.client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: input.key,
            Body: input.body,
            ContentLength: input.body.length,
            ContentType: input.contentType,
            ChecksumSHA256: Buffer.from(input.checksum, 'hex').toString(
              'base64',
            ),
            ServerSideEncryption: 'AES256',
            Metadata: { sha256: input.checksum },
          }),
          { abortSignal: deadline.signal },
        ),
      );
    } catch (error: unknown) {
      throw new ObjectStorageWriteError(classifyS3WriteFailure(error));
    } finally {
      deadline.dispose();
    }
  }

  async getPrivateObject(key: string): Promise<StoredObject> {
    const deadline = new StorageOperationDeadline(this.requestTimeoutMs);
    let request: Promise<GetObjectCommandOutput> | undefined;
    let result: GetObjectCommandOutput | undefined;
    let bodyReadStarted = false;
    try {
      request = this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { abortSignal: deadline.signal },
      );
      result = await deadline.race(request);
      if (
        !result.Body ||
        !result.ContentType ||
        result.ContentLength === undefined ||
        !Number.isSafeInteger(result.ContentLength) ||
        result.ContentLength < 1
      ) {
        throw new ObjectStorageError('malformed_response');
      }
      if (result.ContentLength > MAX_PRIVATE_MEDIA_OBJECT_BYTES) {
        throw new ObjectStorageError('integrity_violation');
      }
      const checksum = result.Metadata?.sha256;
      if (!checksum || !/^[a-f0-9]{64}$/u.test(checksum)) {
        throw new ObjectStorageError('malformed_response');
      }
      bodyReadStarted = true;
      const body = await readBoundedBody(result.Body, deadline);
      if (
        body.length !== result.ContentLength ||
        createHash('sha256').update(body).digest('hex') !== checksum
      ) {
        throw new ObjectStorageError('integrity_violation');
      }
      return {
        body,
        contentType: result.ContentType,
        checksum,
        size: result.ContentLength,
      };
    } catch (error: unknown) {
      if (deadline.expired && result === undefined && request !== undefined) {
        void request.then(
          (lateResult) => cancelResponseBody(lateResult.Body),
          () => undefined,
        );
      } else if (result?.Body && !bodyReadStarted) {
        cancelResponseBody(result.Body);
      }
      if (error instanceof ObjectStorageError) throw error;
      throw new ObjectStorageError(
        isS3ObjectNotFound(error, 'get') ? 'not_found' : 'unavailable',
      );
    } finally {
      deadline.dispose();
    }
  }

  async privateObjectExists(key: string): Promise<boolean> {
    const deadline = new StorageOperationDeadline(this.requestTimeoutMs);
    try {
      await deadline.race(
        this.client.send(
          new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
          { abortSignal: deadline.signal },
        ),
      );
      return true;
    } catch (error: unknown) {
      if (isS3ObjectNotFound(error, 'head')) return false;
      throw new ObjectStorageError('unavailable');
    } finally {
      deadline.dispose();
    }
  }

  async deletePrivateObject(key: string): Promise<void> {
    const deadline = new StorageOperationDeadline(this.requestTimeoutMs);
    try {
      await deadline.race(
        this.client.send(
          new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
          { abortSignal: deadline.signal },
        ),
      );
    } catch {
      throw new ObjectStorageError('unavailable');
    } finally {
      deadline.dispose();
    }
  }
}

function isS3ObjectNotFound(
  error: unknown,
  operation: 'get' | 'head',
): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? error.name : undefined;
  const metadata =
    '$metadata' in error &&
    error.$metadata &&
    typeof error.$metadata === 'object'
      ? error.$metadata
      : undefined;
  const statusCode =
    metadata && 'httpStatusCode' in metadata
      ? metadata.httpStatusCode
      : undefined;
  if (statusCode !== 404) return false;
  return name === 'NoSuchKey' || (operation === 'head' && name === 'NotFound');
}

async function readBoundedBody(
  body: unknown,
  deadline: StorageOperationDeadline,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let complete = false;
  let iterator: AsyncIterator<unknown> | null = null;
  try {
    if (
      !body ||
      typeof body !== 'object' ||
      !(Symbol.asyncIterator in body) ||
      typeof body[Symbol.asyncIterator] !== 'function'
    ) {
      throw new ObjectStorageError('malformed_response');
    }

    try {
      iterator = (body as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    } catch {
      throw new ObjectStorageError('malformed_response');
    }
    if (!iterator || typeof iterator.next !== 'function') {
      throw new ObjectStorageError('malformed_response');
    }
    const activeIterator = iterator;

    while (true) {
      const step = await deadline.race(
        Promise.resolve().then(() => activeIterator.next()),
      );
      if (!step || typeof step !== 'object') {
        throw new ObjectStorageError('malformed_response');
      }
      if (step.done) {
        complete = true;
        break;
      }
      const chunk = step.value;
      if (!(chunk instanceof Uint8Array)) {
        throw new ObjectStorageError('malformed_response');
      }
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_PRIVATE_MEDIA_OBJECT_BYTES) {
        throw new ObjectStorageError('integrity_violation');
      }
      chunks.push(Buffer.from(chunk));
    }
  } finally {
    if (!complete) {
      cancelResponseBody(body, iterator);
    }
  }
  return Buffer.concat(chunks, totalBytes);
}

class StorageDeadlineExceeded extends Error {
  constructor() {
    super('Storage operation deadline exceeded.');
    this.name = 'StorageDeadlineExceeded';
  }
}

class StorageOperationDeadline {
  private readonly controller = new AbortController();
  private readonly timeout: NodeJS.Timeout;
  private readonly expiration: Promise<never>;
  expired = false;

  constructor(timeoutMs: number) {
    let rejectExpiration: (error: StorageDeadlineExceeded) => void = () =>
      undefined;
    this.expiration = new Promise((_, reject) => {
      rejectExpiration = reject;
    });
    this.timeout = setTimeout(() => {
      this.expired = true;
      this.controller.abort();
      rejectExpiration(new StorageDeadlineExceeded());
    }, timeoutMs);
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  race<T>(operation: Promise<T>): Promise<T> {
    return Promise.race([operation, this.expiration]).then(
      (value) => {
        if (this.expired) throw new StorageDeadlineExceeded();
        return value;
      },
      (error: unknown) => {
        if (this.expired) throw new StorageDeadlineExceeded();
        throw error;
      },
    );
  }

  dispose(): void {
    clearTimeout(this.timeout);
  }
}

function cancelResponseBody(
  body: unknown,
  iterator?: AsyncIterator<unknown> | null,
): void {
  let bodyCancelled = false;
  if (body && typeof body === 'object' && 'destroy' in body) {
    const destroy = body.destroy;
    if (typeof destroy === 'function') {
      try {
        destroy.call(body);
        bodyCancelled = true;
      } catch {
        // Cancellation is best-effort after a typed failure is already chosen.
      }
    }
  }
  if (body && typeof body === 'object' && 'cancel' in body) {
    const cancel = body.cancel;
    if (typeof cancel === 'function') {
      try {
        void Promise.resolve(cancel.call(body)).catch(() => undefined);
        bodyCancelled = true;
      } catch {
        // Cancellation is best-effort after a typed failure is already chosen.
      }
    }
  }

  let cancellableIterator = iterator;
  if (
    cancellableIterator === undefined &&
    !bodyCancelled &&
    body &&
    typeof body === 'object' &&
    Symbol.asyncIterator in body &&
    typeof body[Symbol.asyncIterator] === 'function'
  ) {
    try {
      cancellableIterator = (body as AsyncIterable<unknown>)[
        Symbol.asyncIterator
      ]();
    } catch {
      // Cancellation is best-effort after a typed failure is already chosen.
    }
  }

  if (typeof cancellableIterator?.return === 'function') {
    try {
      void Promise.resolve(cancellableIterator.return()).catch(() => undefined);
    } catch {
      // Cancellation is best-effort after a typed failure is already chosen.
    }
  }
}

const DEFINITE_S3_WRITE_REJECTIONS = new Set([
  'AccessDenied',
  'InvalidAccessKeyId',
  'InvalidArgument',
  'InvalidRequest',
  'NoSuchBucket',
  'NotImplemented',
  'SignatureDoesNotMatch',
]);

export function classifyS3WriteFailure(
  error: unknown,
): ObjectStorageWriteOutcome {
  if (!error || typeof error !== 'object') return 'unknown';
  const name = 'name' in error ? error.name : undefined;
  return typeof name === 'string' && DEFINITE_S3_WRITE_REJECTIONS.has(name)
    ? 'definite_not_written'
    : 'unknown';
}
