import sharp from 'sharp';

import { MediaFileProcessor } from './media-file.processor';

describe('MediaFileProcessor', () => {
  const processor = new MediaFileProcessor();

  it('detects, decodes and re-encodes a safe PNG instead of trusting metadata', async () => {
    const source = await sharp({
      create: {
        width: 2,
        height: 3,
        channels: 4,
        background: { r: 12, g: 34, b: 56, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const result = await processor.process({
      buffer: source,
      declaredMimeType: 'image/png',
      filename: 'lesson.png',
    });

    expect(result).toMatchObject({
      mediaType: 'image',
      mimeType: 'image/png',
      extension: 'png',
      width: 2,
      height: 3,
    });
    expect(result.buffer).not.toBe(source);
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/u);
  });

  it.each([
    ['empty', Buffer.alloc(0), 'image/png', 'lesson.png', 'FILE_EMPTY'],
    [
      'truncated image',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      'image/png',
      'lesson.png',
      'FILE_MALFORMED',
    ],
    [
      'spoofed content type',
      Buffer.from('not-an-image'),
      'image/png',
      'lesson.png',
      'MIME_SIGNATURE_MISMATCH',
    ],
    [
      'active content',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      'image/svg+xml',
      'lesson.svg',
      'MEDIA_TYPE_NOT_ALLOWED',
    ],
  ] as const)(
    'rejects %s with a stable safe code',
    async (_, buffer, mime, name, code) => {
      await expect(
        processor.process({
          buffer,
          declaredMimeType: mime,
          filename: name,
        }),
      ).rejects.toMatchObject({ code });
    },
  );

  it('rejects a double extension even when the bytes are otherwise valid', async () => {
    const source = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();

    await expect(
      processor.process({
        buffer: source,
        declaredMimeType: 'image/png',
        filename: 'invoice.pdf.png',
      }),
    ).rejects.toMatchObject({ code: 'FILENAME_EXTENSION_MISMATCH' });
  });

  it('parses a bounded WAV and rejects an appended executable polyglot', async () => {
    const wav = createWaveFixture();
    await expect(
      processor.process({
        buffer: wav,
        declaredMimeType: 'audio/wav',
        filename: 'lesson.wav',
      }),
    ).resolves.toMatchObject({
      mediaType: 'audio',
      mimeType: 'audio/wav',
      extension: 'wav',
      duration: 1,
    });

    const polyglot = Buffer.concat([
      wav,
      Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
    ]);
    polyglot.writeUInt32LE(polyglot.length - 8, 4);
    await expect(
      processor.process({
        buffer: polyglot,
        declaredMimeType: 'audio/wav',
        filename: 'lesson.wav',
      }),
    ).rejects.toMatchObject({ code: 'POLYGLOT_DETECTED' });
  });
});

function createWaveFixture(): Buffer {
  const sampleRate = 8_000;
  const sampleCount = sampleRate;
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}
