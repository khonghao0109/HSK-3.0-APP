import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

import {
  MAX_PRIVATE_MEDIA_OBJECT_BYTES,
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
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          Body: input.body,
          ContentLength: input.body.length,
          ContentType: input.contentType,
          ChecksumSHA256: Buffer.from(input.checksum, 'hex').toString('base64'),
          ServerSideEncryption: 'AES256',
          Metadata: { sha256: input.checksum },
        }),
        { abortSignal: AbortSignal.timeout(this.requestTimeoutMs) },
      );
    } catch (error: unknown) {
      throw new ObjectStorageWriteError(classifyS3WriteFailure(error));
    }
  }

  async getPrivateObject(key: string): Promise<StoredObject> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(this.requestTimeoutMs) },
    );
    if (
      !result.Body ||
      !result.ContentType ||
      result.ContentLength === undefined ||
      result.ContentLength < 1 ||
      result.ContentLength > MAX_PRIVATE_MEDIA_OBJECT_BYTES
    ) {
      throw new Error('Storage object response is incomplete.');
    }
    const checksum = result.Metadata?.sha256;
    if (!checksum || !/^[a-f0-9]{64}$/u.test(checksum)) {
      throw new Error('Storage object checksum metadata is invalid.');
    }
    const body = await readBoundedBody(result.Body);
    if (
      body.length !== result.ContentLength ||
      createHash('sha256').update(body).digest('hex') !== checksum
    ) {
      throw new Error('Storage object integrity does not match its metadata.');
    }
    return {
      body,
      contentType: result.ContentType,
      checksum,
      size: result.ContentLength,
    };
  }

  async privateObjectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(this.requestTimeoutMs) },
      );
      return true;
    } catch (error: unknown) {
      if (isS3NotFound(error)) return false;
      throw new Error('Private object presence could not be verified.');
    }
  }

  async deletePrivateObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(this.requestTimeoutMs) },
    );
  }
}

function isS3NotFound(error: unknown): boolean {
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
  return (
    name === 'NotFound' ||
    name === 'NoSuchKey' ||
    name === 'NoSuchObject' ||
    statusCode === 404
  );
}

async function readBoundedBody(body: unknown): Promise<Buffer> {
  if (
    !body ||
    typeof body !== 'object' ||
    !(Symbol.asyncIterator in body) ||
    typeof body[Symbol.asyncIterator] !== 'function'
  ) {
    throw new Error('Storage object body is not a bounded byte stream.');
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of body as AsyncIterable<unknown>) {
    if (!(chunk instanceof Uint8Array)) {
      throw new Error('Storage object body contains an invalid chunk.');
    }
    totalBytes += chunk.byteLength;
    if (totalBytes > MAX_PRIVATE_MEDIA_OBJECT_BYTES) {
      throw new Error('Storage object body exceeds the maximum size.');
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, totalBytes);
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
