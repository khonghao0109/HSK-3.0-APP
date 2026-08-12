import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

type AllowedExtension = 'jpg' | 'mp3' | 'png' | 'wav';
type MediaFileProcessingErrorCode =
  | 'FILE_EMPTY'
  | 'FILE_MALFORMED'
  | 'FILENAME_EXTENSION_MISMATCH'
  | 'IMAGE_DIMENSIONS_EXCEEDED'
  | 'MEDIA_TYPE_NOT_ALLOWED'
  | 'MIME_SIGNATURE_MISMATCH'
  | 'POLYGLOT_DETECTED';

export class MediaFileProcessingError extends Error {
  constructor(
    readonly code: MediaFileProcessingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MediaFileProcessingError';
  }
}

export type ProcessedMediaFile = {
  buffer: Buffer;
  mediaType: 'audio' | 'image';
  mimeType: 'audio/mpeg' | 'audio/wav' | 'image/jpeg' | 'image/png';
  extension: AllowedExtension;
  checksum: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  metadata: {
    width?: number;
    height?: number;
    sampleRate?: number;
    channels?: number;
  };
};

const ALLOWED_TYPES = {
  jpg: { mime: 'image/jpeg', mediaType: 'image' },
  png: { mime: 'image/png', mediaType: 'image' },
  mp3: { mime: 'audio/mpeg', mediaType: 'audio' },
  wav: { mime: 'audio/wav', mediaType: 'audio' },
} as const;

const MAX_IMAGE_PIXELS = 40_000_000;

@Injectable()
export class MediaFileProcessor {
  async process(input: {
    buffer: Buffer;
    declaredMimeType: string;
    filename: string;
  }): Promise<ProcessedMediaFile> {
    if (input.buffer.length === 0) {
      throw new MediaFileProcessingError('FILE_EMPTY', 'Upload file is empty.');
    }

    const detected = detectMediaSignature(input.buffer);
    if (!detected || !(detected.ext in ALLOWED_TYPES)) {
      const activeContent = /(?:svg|html|javascript|xml)/iu.test(
        input.declaredMimeType,
      );
      throw new MediaFileProcessingError(
        activeContent ? 'MEDIA_TYPE_NOT_ALLOWED' : 'MIME_SIGNATURE_MISMATCH',
        activeContent
          ? 'Media type is not allowed.'
          : 'Media signature is invalid.',
      );
    }
    const extension = detected.ext;
    const allowed = ALLOWED_TYPES[extension];
    if (
      detected.mime !== allowed.mime ||
      input.declaredMimeType !== allowed.mime
    ) {
      throw new MediaFileProcessingError(
        'MIME_SIGNATURE_MISMATCH',
        'Media signature does not match the declared content type.',
      );
    }
    const filenameParts = input.filename.toLowerCase().split('.');
    if (
      filenameParts.length !== 2 ||
      filenameParts[1] !== extension ||
      filenameParts[0].length === 0
    ) {
      throw new MediaFileProcessingError(
        'FILENAME_EXTENSION_MISMATCH',
        'Filename extension does not match the validated media type.',
      );
    }

    if (extension === 'jpg' || extension === 'png') {
      return this.processImage(input.buffer, extension);
    }
    if (containsActiveContentMarker(input.buffer)) {
      throw new MediaFileProcessingError(
        'POLYGLOT_DETECTED',
        'Media contains a disallowed embedded file signature.',
      );
    }
    if (extension === 'wav' && !hasExactWaveContainerLength(input.buffer)) {
      throw new MediaFileProcessingError(
        'FILE_MALFORMED',
        'Audio container length is invalid.',
      );
    }
    return this.processAudio(
      input.buffer,
      extension,
      extension === 'mp3' ? 'audio/mpeg' : 'audio/wav',
    );
  }

  private async processImage(
    buffer: Buffer,
    extension: 'jpg' | 'png',
  ): Promise<ProcessedMediaFile> {
    try {
      const metadata = await sharp(buffer, {
        failOn: 'warning',
        limitInputPixels: MAX_IMAGE_PIXELS,
        sequentialRead: true,
      }).metadata();
      const width = metadata.width ?? 0;
      const height = metadata.height ?? 0;
      if (width <= 0 || height <= 0 || width * height > MAX_IMAGE_PIXELS) {
        throw new MediaFileProcessingError(
          'IMAGE_DIMENSIONS_EXCEEDED',
          'Image dimensions are not allowed.',
        );
      }
      const output =
        extension === 'png'
          ? await sharp(buffer, {
              failOn: 'warning',
              limitInputPixels: MAX_IMAGE_PIXELS,
              sequentialRead: true,
            })
              .rotate()
              .png({ compressionLevel: 9 })
              .toBuffer()
          : await sharp(buffer, {
              failOn: 'warning',
              limitInputPixels: MAX_IMAGE_PIXELS,
              sequentialRead: true,
            })
              .rotate()
              .jpeg({ quality: 90, mozjpeg: true })
              .toBuffer();
      return {
        buffer: output,
        mediaType: 'image',
        mimeType: extension === 'png' ? 'image/png' : 'image/jpeg',
        extension,
        checksum: sha256(output),
        duration: null,
        width,
        height,
        metadata: { width, height },
      };
    } catch (error: unknown) {
      if (error instanceof MediaFileProcessingError) throw error;
      throw new MediaFileProcessingError(
        'FILE_MALFORMED',
        'Image could not be decoded safely.',
      );
    }
  }

  private async processAudio(
    buffer: Buffer,
    extension: 'mp3' | 'wav',
    mimeType: 'audio/mpeg' | 'audio/wav',
  ): Promise<ProcessedMediaFile> {
    try {
      if (extension === 'wav') {
        const wave = parseWaveMetadata(buffer);
        return {
          buffer,
          mediaType: 'audio',
          mimeType,
          extension,
          checksum: sha256(buffer),
          duration: Math.ceil(wave.duration),
          width: null,
          height: null,
          metadata: {
            sampleRate: wave.sampleRate,
            channels: wave.channels,
          },
        };
      }
      const { parseBuffer } = await import('music-metadata');
      const metadata = await parseBuffer(
        buffer,
        { mimeType, size: buffer.length },
        { duration: true, skipCovers: true, skipPostHeaders: true },
      );
      const durationSeconds = metadata.format.duration;
      if (!durationSeconds || !Number.isFinite(durationSeconds)) {
        throw new Error('missing audio duration');
      }
      return {
        buffer,
        mediaType: 'audio',
        mimeType,
        extension,
        checksum: sha256(buffer),
        duration: Math.ceil(durationSeconds),
        width: null,
        height: null,
        metadata: {
          ...(metadata.format.sampleRate
            ? { sampleRate: metadata.format.sampleRate }
            : {}),
          ...(metadata.format.numberOfChannels
            ? { channels: metadata.format.numberOfChannels }
            : {}),
        },
      };
    } catch {
      throw new MediaFileProcessingError(
        'FILE_MALFORMED',
        'Audio could not be parsed safely.',
      );
    }
  }
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function detectMediaSignature(
  buffer: Buffer,
): { ext: AllowedExtension; mime: string } | null {
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    return { ext: 'wav', mime: 'audio/wav' };
  }
  if (
    buffer.length >= 3 &&
    (buffer.subarray(0, 3).toString('ascii') === 'ID3' ||
      (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0))
  ) {
    return { ext: 'mp3', mime: 'audio/mpeg' };
  }
  return null;
}

function hasExactWaveContainerLength(buffer: Buffer): boolean {
  return buffer.length >= 12 && buffer.readUInt32LE(4) + 8 === buffer.length;
}

function parseWaveMetadata(buffer: Buffer): {
  channels: number;
  duration: number;
  sampleRate: number;
} {
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let byteRate = 0;
  let dataSize = 0;
  let pcmFormat = 0;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > buffer.length) throw new Error('truncated WAV chunk');
    if (chunkId === 'fmt ' && chunkSize >= 16) {
      pcmFormat = buffer.readUInt16LE(chunkStart);
      channels = buffer.readUInt16LE(chunkStart + 2);
      sampleRate = buffer.readUInt32LE(chunkStart + 4);
      byteRate = buffer.readUInt32LE(chunkStart + 8);
    } else if (chunkId === 'data') {
      dataSize += chunkSize;
    }
    offset = chunkEnd + (chunkSize % 2);
  }
  if (
    offset !== buffer.length ||
    pcmFormat !== 1 ||
    channels < 1 ||
    channels > 8 ||
    sampleRate < 8_000 ||
    sampleRate > 192_000 ||
    byteRate <= 0 ||
    dataSize <= 0
  ) {
    throw new Error('invalid WAV structure');
  }
  const duration = dataSize / byteRate;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('invalid WAV duration');
  }
  return { channels, duration, sampleRate };
}

function containsActiveContentMarker(buffer: Buffer): boolean {
  const markers = [
    Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
    Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
    Buffer.from('PK\x03\x04', 'binary'),
    Buffer.from('\0asm', 'binary'),
    Buffer.from('<script', 'ascii'),
    Buffer.from('<svg', 'ascii'),
    Buffer.from('%PDF-', 'ascii'),
  ];
  return markers.some((marker) => buffer.indexOf(marker, 3) >= 0);
}
