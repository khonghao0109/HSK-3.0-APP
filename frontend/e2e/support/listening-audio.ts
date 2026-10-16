import type { APIRequestContext } from '@playwright/test';

import { queryDisposableDb } from './disposable-db';

export const AUDIO_SECONDS = 3;

/**
 * WAV PCM 16-bit mono 8 kHz, a quiet 440 Hz sine of AUDIO_SECONDS seconds:
 * deterministic and with no external tool (same as m25c-compare).
 */
export function listeningWav(): Buffer {
  const rate = 8000;
  const samples = rate * AUDIO_SECONDS;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 6000),
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

/**
 * Uploads the WAV through the ingestion API (backend needs
 * MEDIA_INGESTION_ENABLED=true and the memory storage) and waits until the
 * media is ready. The fixed Idempotency-Key replays on a re-run.
 */
export async function ingestListeningAudio(
  api: APIRequestContext,
  backend: string,
  adminToken: string,
): Promise<number> {
  const source = queryDisposableDb(
    'SELECT id FROM "DataSource" ORDER BY id LIMIT 1',
  );
  if (!/^\d+$/u.test(source)) throw new Error('seed has no DataSource');
  const response = await api.post(
    `${backend}/admin/cms/media/ingestions?dataSourceId=${source}`,
    {
      headers: {
        authorization: `Bearer ${adminToken}`,
        'idempotency-key': 'e2e-learner-listening-audio-v1-000000000000',
      },
      multipart: {
        file: {
          name: 'e2e-listening.wav',
          mimeType: 'audio/wav',
          buffer: listeningWav(),
        },
      },
    },
  );
  if (response.status() !== 201) {
    throw new Error(
      `media ingestion → ${response.status()} (backend needs MEDIA_INGESTION_ENABLED=true)`,
    );
  }
  const id = ((await response.json()) as { data: { media: { id: number } } })
    .data.media.id;
  for (let i = 0; i < 30; i++) {
    const detail = await api.get(`${backend}/admin/cms/media/${id}`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const media = (
      (await detail.json()) as {
        data: { processingStatus: string; duration: number | null };
      }
    ).data;
    if (media.processingStatus === 'ready') {
      if (media.duration !== AUDIO_SECONDS) {
        throw new Error(`media ${id}: duration ${media.duration}`);
      }
      return id;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`media ${id} is not ready after 30 seconds`);
}
