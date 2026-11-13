import { createHash, randomUUID } from 'node:crypto';
import {
  createServer as createHttpsServer,
  type Server as HttpsServer,
} from 'node:https';
import { deflateSync } from 'node:zlib';

import {
  MediaProcessingStatus,
  MediaType,
  type PrismaClient,
} from '@prisma/client';

/**
 * M4.4 B3a — Media fixtures tất định và Mock S3 Storage Server.
 *
 * - Sinh WAV PCM 16-bit mono 8 kHz (3 giây mặc định) hoàn toàn trong Node.
 * - Sinh PNG 320x180 RGB gradient bằng node:zlib (deflateSync).
 * - Mock S3 HTTPS server phục vụ GetObject/HeadObject/PutObject cho
 *   S3ObjectStorageAdapter qua MEDIA_STORAGE_ENDPOINT inline; chứng chỉ tự ký
 *   được tin bằng `NODE_EXTRA_CA_CERTS` (không tắt TLS verify).
 * - Seed Media & MediaIngestion (status=completed) bằng ghi trực tiếp vào DB
 *   disposable, theo tiền lệ `exam-attempt.e2e-spec.ts`.
 *
 * Giới hạn của fixture (không được hiểu là đo ingest):
 * - Seed bỏ qua `MediaIngestionService` và quét ClamAV
 *   (`MEDIA_INGESTION_ENABLED=false`); bản ghi Media/MediaIngestion được tạo
 *   thẳng để có dữ liệu đọc, không chứng minh đường ingest/scan.
 * - W6 chỉ đo đường serve: `media-grants` + `GET /media/:id/content` qua S3
 *   adapter; ingest và scan không nằm trong số đo của scenario này.
 */

export const DEFAULT_AUDIO_SECONDS = 3;

/** WAV PCM 16-bit mono 8 kHz với tần số thay đổi theo index (tất định). */
export function generateDeterministicWav(
  index = 1,
  seconds = DEFAULT_AUDIO_SECONDS,
): Buffer {
  const rate = 8000;
  const samples = rate * seconds;
  const data = Buffer.alloc(samples * 2);
  const freq = 440 + ((index - 1) % 20) * 10;
  for (let i = 0; i < samples; i += 1) {
    data.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 6000),
      i * 2,
    );
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) {
    c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** PNG 320x180 RGB gradient thay đổi màu theo index (tất định). */
export function generateDeterministicPng(
  index = 1,
  width = 320,
  height = 180,
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // truecolor
  const rowBytes = width * 3 + 1;
  const raw = Buffer.alloc(rowBytes * height);
  const tint = (index * 17) % 50;
  for (let y = 0; y < height; y += 1) {
    raw[y * rowBytes] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = y * rowBytes + 1 + x * 3;
      raw[offset] = Math.max(0, 226 - Math.floor((y / height) * 46) - tint);
      raw[offset + 1] = Math.max(0, 240 - Math.floor((x / width) * 30) - tint);
      raw[offset + 2] = Math.max(0, 232 - Math.floor((y / height) * 26) + tint);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export type StoredMediaObject = {
  key: string;
  body: Buffer;
  contentType: string;
  checksum: string;
};

export type MockS3Server = {
  url: string;
  port: number;
  close: () => Promise<void>;
};

/**
 * Throwaway self-signed P-256 key cho mock S3 loopback. Chỉ dùng trong capacity
 * run disposable; không phải secret của hệ thống. Secret scan bắt dòng PEM
 * BEGIN nên có đúng 1 entry allowlist (`kind=private_key`) trong
 * `backend/secret-scan.allowlist.json`.
 */
export const MOCK_TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg9iJdXJ8QiTasZgP3
tPSbMB3sWRkCW03/5/vzLZ2TZ8ChRANCAAQLq2/DJXx1ulEIdicsHk/R9FvWrsL+
6C5cQ+E9tqey06aLzL4QaolcwUwbFbTmmd4Dqh3cN2wwsaaR9kKGWZwJ
-----END PRIVATE KEY-----`;

export const MOCK_TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIBeDCCAR6gAwIBAgIUGjW09GxOro/0hU+4i3sndkR9J5owCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MTEwNDAzMDQyOVoXDTM2MTEwMTAz
MDQyOVowFDESMBAGA1UEAwwJMTI3LjAuMC4xMFkwEwYHKoZIzj0CAQYIKoZIzj0D
AQcDQgAEC6tvwyV8dbpRCHYnLB5P0fRb1q7C/uguXEPhPbanstOmi8y+EGqJXMFM
GxW05pneA6od3DdsMLGmkfZChlmcCaNOMEwwHQYDVR0OBBYEFEnCa1YiSlBHBucl
/HwuAzS6dTStMA8GA1UdEwEB/wQFMAMBAf8wGgYDVR0RBBMwEYcEfwAAAYIJbG9j
YWxob3N0MAoGCCqGSM49BAMCA0gAMEUCIDCxxS7p5sipy2xU/zCVToB7Geleucwz
sqF8QQFwYsFxAiEAsRlUiZqoK7+Mp4HpVOqtfHQ80kJxj0Vixgd0uLLY8ZA=
-----END CERTIFICATE-----`;

/**
 * Tạo mock HTTPS server đáp ứng AWS S3 REST API (path-style).
 * S3ObjectStorageAdapter trong server gửi GetObject/HeadObject tới endpoint này.
 */
export async function createMockS3Server(
  store: Map<string, StoredMediaObject>,
  bucket = 'hsk-capacity',
): Promise<MockS3Server> {
  const server: HttpsServer = createHttpsServer(
    { key: MOCK_TLS_KEY, cert: MOCK_TLS_CERT },
    (req, res) => {
      const rawUrl = req.url ?? '/';
      const path = rawUrl.split('?')[0] ?? '/';
      const prefix = `/${bucket}/`;
      if (!path.startsWith(prefix)) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      const key = decodeURIComponent(path.slice(prefix.length));
      const object = store.get(key);

      if (req.method === 'GET' || req.method === 'HEAD') {
        if (!object) {
          res.writeHead(404, { 'content-type': 'application/xml' });
          res.end(`<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>NoSuchKey</Code>
  <Message>The specified key does not exist.</Message>
  <Key>${key}</Key>
  <BucketName>${bucket}</BucketName>
</Error>`);
          return;
        }
        res.writeHead(200, {
          'content-type': object.contentType,
          'content-length': String(object.body.length),
          'x-amz-meta-sha256': object.checksum,
          etag: `"${object.checksum}"`,
        });
        if (req.method === 'HEAD') {
          res.end();
        } else {
          res.end(object.body);
        }
        return;
      }

      if (req.method === 'PUT') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const body = Buffer.concat(chunks);
          const checksum = createHash('sha256').update(body).digest('hex');
          const headerContentType = req.headers['content-type'];
          const contentType =
            typeof headerContentType === 'string'
              ? headerContentType
              : Array.isArray(headerContentType) && headerContentType[0]
                ? headerContentType[0]
                : 'application/octet-stream';
          store.set(key, {
            key,
            body,
            contentType,
            checksum,
          });
          res.writeHead(200, { etag: `"${checksum}"` });
          res.end();
        });
        return;
      }

      if (req.method === 'DELETE') {
        store.delete(key);
        res.writeHead(204);
        res.end();
        return;
      }

      res.writeHead(405, { 'content-type': 'text/plain' });
      res.end('Method Not Allowed');
    },
  );

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to bind mock S3 server address'));
        return;
      }
      resolve({
        url: `https://127.0.0.1:${String(address.port)}`,
        port: address.port,
        close: () =>
          new Promise<void>((closeResolve) => {
            server.close(() => closeResolve());
          }),
      });
    });
  });
}

export type SeedMediaResult = {
  audioMediaIds: number[];
  imageMediaIds: number[];
  mediaSha256: Map<number, string>;
  mediaDigestList: Array<{
    id: number;
    kind: string;
    sha256: string;
    size: number;
  }>;
};

/**
 * Seed N audio và M image media vào database disposable và nạp vào mock S3 store.
 * Mỗi media có MediaIngestion status=completed và idempotencyKey cố định.
 */
export async function seedMediaAssets(input: {
  prisma: PrismaClient;
  adminId: number;
  audioCount: number;
  imagesCount: number;
  store: Map<string, StoredMediaObject>;
  suffix: string;
}): Promise<SeedMediaResult> {
  const { prisma, adminId, audioCount, imagesCount, store, suffix } = input;
  const audioMediaIds: number[] = [];
  const imageMediaIds: number[] = [];
  const mediaSha256 = new Map<number, string>();
  const mediaDigestList: Array<{
    id: number;
    kind: string;
    sha256: string;
    size: number;
  }> = [];

  if (audioCount <= 0 && imagesCount <= 0) {
    return { audioMediaIds, imageMediaIds, mediaSha256, mediaDigestList };
  }

  const dataSource = await prisma.dataSource.upsert({
    where: {
      name_version: {
        name: `Capacity Fixture Source ${suffix}`,
        version: '2026.11',
      },
    },
    update: {},
    create: {
      code: `CAP_SOURCE_${suffix}`,
      name: `Capacity Fixture Source ${suffix}`,
      version: '2026.11',
      license: 'Synthetic fixture; capacity testing only',
      createdById: adminId,
    },
  });

  // Seed audio
  for (let index = 1; index <= audioCount; index += 1) {
    const buffer = generateDeterministicWav(index);
    const checksum = createHash('sha256').update(buffer).digest('hex');
    const storageKey = `media/2026/11/${suffix}-audio-${String(index).padStart(4, '0')}.wav`;
    const idempotencyKey = `capacity-exam-audio-${suffix}-${String(index).padStart(4, '0')}-${randomUUID()}`;
    const idempotencyKeyHash = createHash('sha256')
      .update(idempotencyKey)
      .digest('hex');

    store.set(storageKey, {
      key: storageKey,
      body: buffer,
      contentType: 'audio/wav',
      checksum,
    });

    const media = await prisma.media.create({
      data: {
        url: 'pending',
        type: MediaType.audio,
        mimeType: 'audio/wav',
        size: buffer.length,
        duration: DEFAULT_AUDIO_SECONDS,
        storageProvider: 's3',
        storageKey,
        checksum,
        processingStatus: MediaProcessingStatus.ready,
        dataSourceId: dataSource.id,
        uploadedById: adminId,
      },
      select: { id: true },
    });

    await prisma.media.update({
      where: { id: media.id },
      data: { url: `/api/v1/media/${String(media.id)}/access` },
    });

    await prisma.mediaIngestion.create({
      data: {
        actorId: adminId,
        dataSourceId: dataSource.id,
        idempotencyKeyHash,
        requestFingerprint: idempotencyKeyHash,
        status: 'completed',
        originalFilename: `audio-${String(index)}.wav`,
        declaredMimeType: 'audio/wav',
        validatedMimeType: 'audio/wav',
        size: buffer.length,
        checksum,
        storageProvider: 's3',
        storageKey,
        mediaId: media.id,
        processingToken: randomUUID(),
        sourceCodeSnapshot: dataSource.code,
        sourceVersionSnapshot: dataSource.version,
        sourceLicenseSnapshot: dataSource.license ?? 'Synthetic fixture',
        completedAt: new Date(),
      },
    });

    audioMediaIds.push(media.id);
    mediaSha256.set(media.id, checksum);
    mediaDigestList.push({
      id: media.id,
      kind: 'audio',
      sha256: checksum,
      size: buffer.length,
    });
  }

  // Seed images
  for (let index = 1; index <= imagesCount; index += 1) {
    const buffer = generateDeterministicPng(index);
    const checksum = createHash('sha256').update(buffer).digest('hex');
    const storageKey = `media/2026/11/${suffix}-image-${String(index).padStart(4, '0')}.png`;
    const idempotencyKey = `capacity-exam-image-${suffix}-${String(index).padStart(4, '0')}-${randomUUID()}`;
    const idempotencyKeyHash = createHash('sha256')
      .update(idempotencyKey)
      .digest('hex');

    store.set(storageKey, {
      key: storageKey,
      body: buffer,
      contentType: 'image/png',
      checksum,
    });

    const media = await prisma.media.create({
      data: {
        url: 'pending',
        type: MediaType.image,
        mimeType: 'image/png',
        size: buffer.length,
        storageProvider: 's3',
        storageKey,
        checksum,
        processingStatus: MediaProcessingStatus.ready,
        dataSourceId: dataSource.id,
        uploadedById: adminId,
      },
      select: { id: true },
    });

    await prisma.media.update({
      where: { id: media.id },
      data: { url: `/api/v1/media/${String(media.id)}/access` },
    });

    await prisma.mediaIngestion.create({
      data: {
        actorId: adminId,
        dataSourceId: dataSource.id,
        idempotencyKeyHash,
        requestFingerprint: idempotencyKeyHash,
        status: 'completed',
        originalFilename: `image-${String(index)}.png`,
        declaredMimeType: 'image/png',
        validatedMimeType: 'image/png',
        size: buffer.length,
        checksum,
        storageProvider: 's3',
        storageKey,
        mediaId: media.id,
        processingToken: randomUUID(),
        sourceCodeSnapshot: dataSource.code,
        sourceVersionSnapshot: dataSource.version,
        sourceLicenseSnapshot: dataSource.license ?? 'Synthetic fixture',
        completedAt: new Date(),
      },
    });

    imageMediaIds.push(media.id);
    mediaSha256.set(media.id, checksum);
    mediaDigestList.push({
      id: media.id,
      kind: 'image',
      sha256: checksum,
      size: buffer.length,
    });
  }

  return { audioMediaIds, imageMediaIds, mediaSha256, mediaDigestList };
}
