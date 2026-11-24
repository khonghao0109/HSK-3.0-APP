/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import request from 'supertest';

import { AppModule } from '../src/app.module';
import { MediaFileProcessor } from '../src/modules/cms/media-ingestion/media-file.processor';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import {
  AUDIO_ATTACHED_AUDIT_ACTION,
  checkAudioBytes,
  importTextbookAudio,
  type TextbookAudioLesson,
} from '../src/modules/content-pilot/textbook-audio';
import { TEXTBOOK_DATA_SOURCE } from '../src/modules/content-pilot/textbook-seeddata.converter';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

/** A tiny self-made MPEG-1 Layer III file: four silent frames, never seeddata. */
function silentMp3(seed: number): Buffer {
  const frame = () => {
    const bytes = Buffer.alloc(417);
    bytes.set([0xff, 0xfb, 0x90, 0x64]);
    bytes[40] = seed;
    return bytes;
  };
  return Buffer.concat([frame(), frame(), frame(), frame()]);
}

/**
 * M2.13c — textbook vocabulary audio through the media ingestion route, on a
 * synthetic lesson of this suite (own slug, own words) at a random high
 * orderIndex of HSK7_9. `afterAll` archives the lesson and deletes its words.
 */
describe('Textbook vocabulary audio import (M2.13c) E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let adminId: number;
  let apiBaseUrl: string;
  let root: string;
  let lessonId: number;
  let presetMediaId: number;
  const wordIds: number[] = [];
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const slug = `m213c-audio-${suffix}`;
  const password = 'StrongPassword123!';
  // Third word already has audio (e.g. from the HSK 3.0 dictionary).
  const WORDS = [
    { hanzi: '䨻', pinyin: `bing${suffix}`, audioRef: 'audio/a.mp3' },
    { hanzi: '䲜', pinyin: `du${suffix}`, audioRef: 'audio/b.mp3' },
    { hanzi: '䶑', pinyin: `nang${suffix}`, audioRef: 'audio/c.mp3' },
    { hanzi: '䨺', pinyin: `ling${suffix}`, audioRef: 'audio/missing.mp3' },
  ];
  const lesson = (): TextbookAudioLesson => ({
    fileName: 'lesson-01.json',
    slug,
    words: WORDS,
  });
  const run = (dryRun: boolean, ledger = 'ledger.json') =>
    importTextbookAudio(
      { apiBaseUrl, adminToken, prisma, sleep: () => Promise.resolve() },
      {
        lessons: [lesson()],
        seeddataRoot: root,
        audioBaseDir: join(root, 'vocab'),
        ledgerPath: join(root, ledger),
        dryRun,
        actorId: dryRun ? null : adminId,
      },
    );
  const sha = (seed: number) =>
    createHash('sha256').update(silentMp3(seed)).digest('hex');

  beforeAll(async () => {
    assertDisposableTestDatabase();
    // Jest cannot load the ESM-only `music-metadata` the processor imports
    // (`--experimental-vm-modules`), so only its mp3 parse step is replaced;
    // signature, MIME and filename checks stay real. The real parse of these
    // fixture frames is shown separately in the M2.13c report.
    const real = new MediaFileProcessor();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MediaFileProcessor)
      .useValue({
        process: async (input: {
          buffer: Buffer;
          declaredMimeType: string;
          filename: string;
        }) =>
          input.declaredMimeType === 'audio/mpeg' &&
          /^[0-9a-f]{32}\.mp3$/u.test(input.filename) &&
          checkAudioBytes(input.buffer) === null
            ? {
                buffer: input.buffer,
                mediaType: 'audio' as const,
                mimeType: 'audio/mpeg' as const,
                extension: 'mp3' as const,
                checksum: createHash('sha256')
                  .update(input.buffer)
                  .digest('hex'),
                duration: 1,
                width: null,
                height: null,
                metadata: {},
              }
            : real.process(input),
      })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        exceptionFactory: createSafeValidationException,
      }),
    );
    await app.init();
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    apiBaseUrl = `http://127.0.0.1:${String(address.port)}/api/v1`;
    prisma = app.get(PrismaService);

    const email = `m213c-admin-${suffix}@example.com`;
    const registered = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, name: 'Audio admin' })
      .expect(201);
    adminId = registered.body.data.user.id as number;
    await prisma.user.update({
      where: { id: adminId },
      data: { role: 'admin' },
    });
    adminToken = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(201)
    ).body.data.accessToken as string;
    await prisma.mediaUploadRateLimit.deleteMany({
      where: { actorId: adminId },
    });

    root = mkdtempSync('/tmp/hsk-m213c-e2e-');
    mkdirSync(join(root, 'vocab', 'audio'), { recursive: true });
    writeFileSync(join(root, 'vocab', 'audio', 'a.mp3'), silentMp3(1));
    writeFileSync(join(root, 'vocab', 'audio', 'b.mp3'), silentMp3(2));
    writeFileSync(join(root, 'vocab', 'audio', 'c.mp3'), silentMp3(3));

    presetMediaId = (
      await prisma.media.create({
        data: {
          url: `https://cdn.example.test/m213c-${suffix}.mp3`,
          type: 'audio',
          mimeType: 'audio/mpeg',
          duration: 1,
          processingStatus: 'ready',
          storageProvider: 's3',
          storageKey: `private/m213c-${suffix}.mp3`,
          checksum: `internal-m213c-${suffix}`,
        },
        select: { id: true },
      })
    ).id;
    const level = await prisma.level.upsert({
      where: { code: 'HSK7_9' },
      update: {},
      create: {
        code: 'HSK7_9',
        name: 'HSK 7-9',
        orderIndex: 7,
        minBand: 7,
        maxBand: 9,
        status: 'published',
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    lessonId = (
      await prisma.lesson.create({
        data: {
          levelId: level.id,
          title: `M2.13c ${suffix}`,
          slug,
          orderIndex: 70_000 + Math.floor(Math.random() * 20_000),
        },
        select: { id: true },
      })
    ).id;
    for (const [index, word] of WORDS.entries()) {
      const row = await prisma.word.create({
        data: {
          hanzi: word.hanzi,
          pinyin: word.pinyin,
          pinyinNormalized: word.pinyin,
          ...(index === 2 ? { audioId: presetMediaId } : {}),
        },
        select: { id: true },
      });
      wordIds.push(row.id);
      await prisma.lessonWord.create({
        data: { lessonId, wordId: row.id, orderIndex: index },
      });
    }
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.lesson.update({
        where: { id: lessonId },
        data: { status: 'archived', deletedAt: new Date() },
      });
      await prisma.word.deleteMany({ where: { id: { in: wordIds } } });
    }
    if (app) await app.close();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  const wordAudio = async () =>
    (
      await prisma.word.findMany({
        where: { id: { in: wordIds } },
        orderBy: { id: 'asc' },
        select: { audioId: true },
      })
    ).map((row) => row.audioId);
  const ownMedia = () =>
    prisma.media.findMany({
      where: { checksum: { in: [sha(1), sha(2), sha(3)] } },
      select: {
        id: true,
        type: true,
        mimeType: true,
        checksum: true,
        dataSource: { select: { code: true } },
      },
    });

  it('A1. dry-run counts files, missing and existing audio without writing', async () => {
    const summary = await run(true);
    expect(summary.lessons).toEqual([
      {
        fileName: 'lesson-01.json',
        words: 4,
        files: 3,
        bytes: 3 * 1668,
        missing: 1,
        invalid: 0,
        wordNotFound: 0,
        pending: 2,
        ingested: 0,
        attached: 0,
        skippedHasAudio: 1,
        errors: 0,
      },
    ]);
    expect(summary.errorCodes).toEqual({ audio_missing: 1 });
    await expect(wordAudio()).resolves.toEqual([
      null,
      null,
      presetMediaId,
      null,
    ]);
    await expect(ownMedia()).resolves.toEqual([]);
  });

  it('A2. ingests with textbook provenance, attaches once and audits', async () => {
    const summary = await run(false);
    expect(summary.errorCodes).toEqual({ audio_missing: 1 });
    expect(summary.totals).toMatchObject({
      ingested: 2,
      attached: 2,
      skippedHasAudio: 1,
      missing: 1,
      errors: 0,
    });
    const media = await ownMedia();
    // c.mp3 belongs to the Word that keeps its audio: never uploaded.
    expect(media.map((row) => row.checksum).sort()).toEqual(
      [sha(1), sha(2)].sort(),
    );
    for (const row of media) {
      expect(row).toMatchObject({
        type: 'audio',
        mimeType: 'audio/mpeg',
        dataSource: { code: TEXTBOOK_DATA_SOURCE.code },
      });
    }
    const audio = await wordAudio();
    expect(audio[2]).toBe(presetMediaId);
    expect(audio[3]).toBeNull();
    expect(new Set([audio[0], audio[1]])).toEqual(
      new Set(media.map((row) => row.id)),
    );
    const audits = await prisma.auditLog.findMany({
      where: {
        action: AUDIO_ATTACHED_AUDIT_ACTION,
        targetId: { in: wordIds.map(String) },
      },
      select: { actorId: true, targetId: true, afterSummary: true },
    });
    expect(audits).toHaveLength(2);
    expect(audits.every((row) => row.actorId === adminId)).toBe(true);
  });

  it('A3. reruns, even without the ledger, create no duplicate media', async () => {
    const before = await wordAudio();
    const again = await run(false);
    expect(again.totals).toMatchObject({
      ingested: 0,
      attached: 0,
      skippedHasAudio: 3,
    });
    await prisma.mediaUploadRateLimit.deleteMany({
      where: { actorId: adminId },
    });
    // Word audio already set: nothing to upload even with a fresh ledger.
    const fresh = await run(false, 'fresh-ledger.json');
    expect(fresh.totals).toMatchObject({ ingested: 0, attached: 0 });
    await expect(ownMedia()).resolves.toHaveLength(2);
    await expect(wordAudio()).resolves.toEqual(before);
  });

  it('A4. a fresh ledger reuses the ingested media through the idempotency key', async () => {
    const [first] = wordIds;
    await prisma.word.update({ where: { id: first }, data: { audioId: null } });
    await prisma.mediaUploadRateLimit.deleteMany({
      where: { actorId: adminId },
    });
    const summary = await run(false, 'other-ledger.json');
    expect(summary.totals).toMatchObject({ attached: 1, errors: 0 });
    await expect(ownMedia()).resolves.toHaveLength(2);
  });

  it('A5. refuses a ledger written for another environment', async () => {
    const ledger = JSON.parse(
      readFileSync(join(root, 'ledger.json'), 'utf8'),
    ) as { apiBaseUrl: string; media: Record<string, number> };
    expect(ledger.apiBaseUrl).toBe(apiBaseUrl);
    writeFileSync(
      join(root, 'foreign-ledger.json'),
      JSON.stringify({
        ...ledger,
        apiBaseUrl: 'http://staging.invalid/api/v1',
      }),
    );
    await expect(run(false, 'foreign-ledger.json')).rejects.toMatchObject({
      code: 'ledger_environment_mismatch',
    });
  });
});
