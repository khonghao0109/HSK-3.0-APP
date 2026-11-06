/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { normalizeMeaning } from '../src/common/utils/normalize-meaning';
import { normalizePinyin } from '../src/common/utils/normalize-pinyin';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { PUBLIC_WORD_WHERE } from '../src/modules/dictionary/public-word.policy';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

type SearchResult = { id: number; hanzi: string; pinyin: string };

/** M2.B14: `GET /dictionary` also matches Vietnamese and English meanings (Q64). */
describe('Dictionary search E2E (M2.B14)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const words: Record<string, number> = {};
  const restoredLevels: Array<{
    id: number;
    status: 'draft' | 'published' | 'archived';
  }> = [];
  let draftLevel: {
    id: number;
    status: 'draft' | 'published' | 'archived';
    created: boolean;
  };
  const manyIds: number[] = [];

  // Queries accept letters only, so the run tag is spelled with a-j.
  const tag = String(Date.now())
    .slice(-8)
    .replace(/\d/g, (digit) => String.fromCharCode(97 + Number(digit)));
  const pinyinPrefix = `zq${tag}`;
  const meaningToken = `mq${tag}`;

  async function createWord(options: {
    pinyin: string;
    pinyinNormalized?: string;
    hanzi?: string;
    meaningEn: string;
    meaningVi?: string;
    meaningViNormalized?: string;
    status?: 'draft' | 'published';
    isPure?: boolean;
    levelId?: number;
  }): Promise<number> {
    const word = await prisma.word.create({
      data: {
        hanzi: options.hanzi ?? '学习',
        pinyin: options.pinyin,
        pinyinNormalized:
          options.pinyinNormalized ?? normalizePinyin(options.pinyin),
        status: options.status ?? 'published',
        isPure: options.isPure ?? true,
        meanings: {
          create: [
            {
              meaningOrder: 1,
              meaningEn: options.meaningEn,
              meaningEnNormalized: normalizeMeaning(options.meaningEn),
              meaningVi: options.meaningVi,
              meaningViNormalized:
                options.meaningViNormalized ??
                (options.meaningVi === undefined
                  ? undefined
                  : normalizeMeaning(options.meaningVi)),
            },
          ],
        },
        ...(options.levelId === undefined
          ? {}
          : { wordLevels: { create: [{ levelId: options.levelId }] } }),
      },
      select: { id: true },
    });
    return word.id;
  }

  async function search(query: string): Promise<SearchResult[]> {
    const response = await request(app.getHttpServer())
      .get('/api/v1/dictionary')
      .query({ query })
      .expect(200);
    return response.body.data as SearchResult[];
  }
  const idsOf = (results: SearchResult[]) => results.map((word) => word.id);

  beforeAll(async () => {
    assertDisposableTestDatabase();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);

    const hsk1 = await prisma.level.upsert({
      where: { code: 'HSK1' },
      update: { status: 'published', deletedAt: null },
      create: {
        code: 'HSK1',
        name: 'HSK 1',
        orderIndex: 1,
        minBand: 1,
        maxBand: 1,
        status: 'published',
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    // Level codes are fixed by Level_code_band_check, so HSK5 serves as the
    // draft Level: an existing row is flipped and restored afterwards, a row
    // created here is removed again.
    const existingHsk5 = await prisma.level.findUnique({
      where: { code: 'HSK5' },
      select: { id: true, status: true },
    });
    if (existingHsk5) {
      draftLevel = { ...existingHsk5, created: false };
      await prisma.level.update({
        where: { id: existingHsk5.id },
        data: { status: 'draft' },
      });
    } else {
      const createdHsk5 = await prisma.level.create({
        data: {
          code: 'HSK5',
          name: `M2.B14 HSK 5 ${tag}`,
          orderIndex: 5,
          minBand: 5,
          maxBand: 5,
          status: 'draft',
        },
        select: { id: true, status: true },
      });
      draftLevel = { ...createdHsk5, created: true };
    }

    // Level codes are fixed by Level_code_band_check, so HSK3 and HSK7_9 are
    // upserted by code; a row that was not published is restored afterwards.
    const publishedLevel = async (
      code: 'HSK3' | 'HSK7_9',
      orderIndex: number,
      minBand: number,
      maxBand: number,
    ) => {
      const existing = await prisma.level.findUnique({
        where: { code },
        select: { id: true, status: true },
      });
      if (existing && existing.status !== 'published') {
        restoredLevels.push(existing);
      }
      return prisma.level.upsert({
        where: { code },
        update: { status: 'published', deletedAt: null },
        create: {
          code,
          name: `M2.B14 ${code} ${tag}`,
          orderIndex,
          minBand,
          maxBand,
          status: 'published',
          publishedAt: new Date(),
        },
        select: { id: true },
      });
    };
    const hsk3 = await publishedLevel('HSK3', 3, 3, 3);
    const hsk79 = await publishedLevel('HSK7_9', 7, 7, 9);

    // HSK3 words are created first: the HSK1 word must lead despite its id.
    words.levelMeaningHsk3 = await createWord({
      pinyin: `${pinyinPrefix}levmeaninga`,
      meaningEn: `${meaningToken}lvl word`,
      levelId: hsk3.id,
    });
    words.levelMeaningHsk1 = await createWord({
      pinyin: `${pinyinPrefix}levmeaningb`,
      meaningEn: `${meaningToken}lvl word`,
      levelId: hsk1.id,
    });
    words.levelPinyinHsk3 = await createWord({
      hanzi: '鼎鼎',
      pinyin: `${pinyinPrefix}lvl a`,
      pinyinNormalized: `${pinyinPrefix}lvl`,
      meaningEn: 'level pinyin hsk3',
      levelId: hsk3.id,
    });
    words.levelPinyinHsk1 = await createWord({
      hanzi: '鼎鼎',
      pinyin: `${pinyinPrefix}lvl b`,
      pinyinNormalized: `${pinyinPrefix}lvl`,
      meaningEn: 'level pinyin hsk1',
      levelId: hsk1.id,
    });
    words.levelHanziHsk3 = await createWord({
      hanzi: '齉',
      pinyin: `${pinyinPrefix}levhanzia`,
      meaningEn: 'level hanzi hsk3',
      levelId: hsk3.id,
    });
    words.levelHanziHsk1 = await createWord({
      hanzi: '齉',
      pinyin: `${pinyinPrefix}levhanzib`,
      meaningEn: 'level hanzi hsk1',
      levelId: hsk1.id,
    });
    words.noLevel = await createWord({
      pinyin: `${pinyinPrefix}nullsa`,
      meaningEn: `${meaningToken}nul word`,
    });
    words.levelHsk79 = await createWord({
      pinyin: `${pinyinPrefix}nullsb`,
      meaningEn: `${meaningToken}nul word`,
      levelId: hsk79.id,
    });

    words.shocking = await createWord({
      pinyin: `${pinyinPrefix}shocking`,
      meaningEn: 'shocking',
    });
    words.hockey = await createWord({
      pinyin: `${pinyinPrefix}hockey`,
      meaningEn: 'hockey',
    });
    words.taiLieu = await createWord({
      pinyin: `${pinyinPrefix}tailieu`,
      meaningEn: 'study materials',
      meaningVi: 'tài liệu học tập',
    });
    words.fieldOfStudy = await createWord({
      pinyin: `${pinyinPrefix}field`,
      meaningEn: 'field of study (long)',
    });
    words.studyAncient = await createWord({
      pinyin: `${pinyinPrefix}ancient`,
      meaningEn: 'study of ancient texts',
    });
    // Created after the longer and inexact matches: order must not follow id.
    words.studyHall = await createWord({
      pinyin: `${pinyinPrefix}hall`,
      meaningEn: 'study hall',
    });
    words.toStudy = await createWord({
      pinyin: `${pinyinPrefix}tostudy`,
      meaningEn: 'to study',
    });
    words.hskDraftLevel = await createWord({
      pinyin: `${pinyinPrefix}hskdraft`,
      meaningEn: `${meaningToken}rank word`,
      levelId: draftLevel.id,
    });
    words.hskPublished = await createWord({
      pinyin: `${pinyinPrefix}hskpublished`,
      meaningEn: `${meaningToken}rank word`,
      levelId: hsk1.id,
    });
    words.pinyinXuexiHsk = await createWord({
      pinyin: `xuexi ${tag}hsk`,
      pinyinNormalized: 'xuexi',
      meaningEn: 'pinyin rank one',
      levelId: hsk1.id,
    });
    words.pinyinXue = await createWord({
      pinyin: `xue ${tag}`,
      pinyinNormalized: 'xue',
      meaningEn: 'pinyin rank two',
    });
    words.pinyinXuexi = await createWord({
      pinyin: `xuexi ${tag}`,
      pinyinNormalized: 'xuexi',
      meaningEn: 'pinyin rank three',
    });
    words.hanziShort = await createWord({
      hanzi: '龘',
      pinyin: `${pinyinPrefix}hanzishort`,
      meaningEn: 'hanzi rank short',
    });
    words.hanziHsk = await createWord({
      hanzi: '龘龘',
      pinyin: `${pinyinPrefix}hanzihsk`,
      meaningEn: 'hanzi rank hsk',
      levelId: hsk1.id,
    });
    words.toBecome = await createWord({
      pinyin: `${pinyinPrefix}tobecome`,
      meaningEn: 'to become',
    });
    words.toBe = await createWord({
      pinyin: `${pinyinPrefix}tobe`,
      meaningEn: 'to be',
    });
    words.manyMeaningOnly = await createWord({
      pinyin: `${pinyinPrefix}mnyother`,
      meaningEn: `${pinyinPrefix}many extra`,
    });

    words.study = await createWord({
      // (hanzi, pinyin) is unique, so the display pinyin carries the run tag.
      pinyin: `xué xí ${tag}`,
      pinyinNormalized: normalizePinyin('xue2 xi2'),
      meaningEn: 'to study',
      meaningVi: 'học tập',
    });
    words.meaningXue = await createWord({
      pinyin: `${pinyinPrefix}xue`,
      meaningEn: 'xuexi homework',
    });
    words.legacy = await createWord({
      pinyin: `${pinyinPrefix}legacy`,
      meaningEn: 'legacy row',
      meaningVi: 'học tập',
      // Normalized the way the P0 backfill did: lower(btrim()), accents kept.
      meaningViNormalized: 'học tập',
    });
    words.hPinyin = await createWord({
      pinyin: `h${tag}`,
      meaningEn: 'pinyin starting with h',
    });
    words.hMeaning = await createWord({
      pinyin: `${pinyinPrefix}hmeaning`,
      meaningEn: 'h only in meaning',
    });
    words.draft = await createWord({
      pinyin: `${pinyinPrefix}draft`,
      meaningEn: `${meaningToken}hidden draft`,
      status: 'draft',
    });
    words.impure = await createWord({
      pinyin: `${pinyinPrefix}impure`,
      meaningEn: `${meaningToken}hidden impure`,
      isPure: false,
    });
    words.visible = await createWord({
      pinyin: `${pinyinPrefix}visible`,
      meaningEn: `${meaningToken}hidden visible`,
    });
    words.both = await createWord({
      pinyin: `${pinyinPrefix}both`,
      meaningEn: `${pinyinPrefix}both meaning`,
    });
    for (let index = 0; index < 22; index += 1) {
      manyIds.push(
        await createWord({
          pinyin: `${pinyinPrefix}many${String.fromCharCode(97 + index)}`,
          meaningEn: `${meaningToken}many ${index}`,
        }),
      );
    }
  });

  afterAll(async () => {
    for (const level of restoredLevels) {
      await prisma.level.update({
        where: { id: level.id },
        data: { status: level.status },
      });
    }
    if (prisma && draftLevel?.created) {
      // WordLevel rows of this suite cascade with the Level.
      await prisma.level.delete({ where: { id: draftLevel.id } });
    } else if (prisma && draftLevel) {
      await prisma.level.update({
        where: { id: draftLevel.id },
        data: { status: draftLevel.status },
      });
    }
    await prisma?.rateLimitCounter.deleteMany();
    if (app) await app.close();
  });

  it('matches a Vietnamese meaning with or without accents', async () => {
    expect(idsOf(await search('hoc'))).toContain(words.study);
    expect(idsOf(await search('học'))).toContain(words.study);
  });

  it('matches an English meaning', async () => {
    expect(idsOf(await search('study'))).toContain(words.study);
  });

  it('lists pinyin matches before words matched only by meaning', async () => {
    const ids = idsOf(await search('xue'));
    expect(ids).toContain(words.study);
    expect(ids).toContain(words.meaningXue);
    expect(ids.indexOf(words.study)).toBeLessThan(
      ids.indexOf(words.meaningXue),
    );
  });

  it('does not search meanings for a one-character query', async () => {
    const results = await search('h');
    const pinyinMatches = await prisma.word.count({
      where: {
        AND: [
          PUBLIC_WORD_WHERE,
          { id: { in: idsOf(results) } },
          { pinyinNormalized: { startsWith: 'h' } },
        ],
      },
    });
    expect(results.length).toBeGreaterThan(0);
    expect(pinyinMatches).toBe(results.length);
    expect(idsOf(results)).not.toContain(words.hMeaning);
    expect(idsOf(results)).toContain(words.hPinyin);
  });

  it('hides draft and impure words matched by meaning', async () => {
    const ids = idsOf(await search(`${meaningToken}hidden`));
    expect(ids).toEqual([words.visible]);
  });

  it('hides draft and impure words matched by pinyin', async () => {
    expect(await search(`${pinyinPrefix}draft`)).toEqual([]);
    expect(await search(`${pinyinPrefix}impure`)).toEqual([]);
    expect(idsOf(await search(`${pinyinPrefix}visible`))).toEqual([
      words.visible,
    ]);
  });

  it('returns a word matched by pinyin and meaning once', async () => {
    const ids = idsOf(await search(`${pinyinPrefix}both`));
    expect(ids.filter((id) => id === words.both)).toHaveLength(1);
  });

  it('caps meaning matches at 20 in a stable id order', async () => {
    const first = idsOf(await search(`${meaningToken}many`));
    const second = idsOf(await search(`${meaningToken}many`));
    expect(first).toEqual(manyIds.slice(0, 20));
    expect(second).toEqual(first);
  });

  it.each(['<script>', '%', 'a'.repeat(65)])(
    'returns [] with 200 for the invalid query %j',
    async (query) => {
      expect(await search(query)).toEqual([]);
    },
  );

  it('keeps hanzi prefix search and lists words with a Level first', async () => {
    const results = await search('龘');
    expect(results.every((word) => word.hanzi.startsWith('龘'))).toBe(true);
    const ids = idsOf(results);
    expect(ids).toEqual(
      expect.arrayContaining([words.hanziHsk, words.hanziShort]),
    );
    expect(ids.indexOf(words.hanziHsk)).toBeLessThan(
      ids.indexOf(words.hanziShort),
    );
  });

  it('matches meanings at a word start only', async () => {
    const hoc = idsOf(await search('hoc'));
    expect(hoc).not.toContain(words.shocking);
    expect(hoc).toContain(words.hockey);
    expect(hoc).toContain(words.taiLieu);
    expect(idsOf(await search('hoc tap'))).toContain(words.taiLieu);
  });

  it('lists an exact meaning first, even with a larger id', async () => {
    const ids = idsOf(await search('study'));
    expect(ids.indexOf(words.toStudy)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(words.toStudy)).toBeLessThan(
      ids.indexOf(words.fieldOfStudy),
    );
  });

  it('lists a word with a published Level first; a draft Level does not count', async () => {
    const ids = idsOf(await search(`${meaningToken}rank`));
    expect(ids).toEqual([words.hskPublished, words.hskDraftLevel]);
  });

  it('lists a shorter matching meaning first', async () => {
    const ids = idsOf(await search('study'));
    expect(ids.indexOf(words.studyHall)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(words.studyHall)).toBeLessThan(
      ids.indexOf(words.studyAncient),
    );
  });

  it('ranks pinyin by Level, then a whole match, then length', async () => {
    const ids = idsOf(await search('xue'));
    const order = [words.pinyinXuexiHsk, words.pinyinXue, words.pinyinXuexi];
    expect(ids).toEqual(expect.arrayContaining(order));
    expect(order.map((id) => ids.indexOf(id))).toEqual(
      [...order.map((id) => ids.indexOf(id))].sort((a, b) => a - b),
    );
  });

  it('returns the same order on repeated calls', async () => {
    for (const query of ['study', 'xue', '龘', 'hoc']) {
      expect(idsOf(await search(query))).toEqual(idsOf(await search(query)));
    }
  });

  it('adds no meaning match once pinyin fills 20', async () => {
    const ids = idsOf(await search(`${pinyinPrefix}many`));
    expect(ids).toHaveLength(20);
    expect(ids.every((id) => manyIds.includes(id))).toBe(true);
    expect(ids).not.toContain(words.manyMeaningOnly);
  });

  it('lists the exact "to be" before "to become"', async () => {
    const ids = idsOf(await search('to be'));
    expect(ids.indexOf(words.toBe)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(words.toBe)).toBeLessThan(ids.indexOf(words.toBecome));
  });

  it.each([
    [
      'meaning',
      () => `${meaningToken}lvl`,
      'levelMeaningHsk1',
      'levelMeaningHsk3',
    ],
    [
      'pinyin',
      () => `${pinyinPrefix}lvl`,
      'levelPinyinHsk1',
      'levelPinyinHsk3',
    ],
    ['hanzi', () => '齉', 'levelHanziHsk1', 'levelHanziHsk3'],
  ])(
    'lists the lower HSK Level first on the %s path',
    async (_path, query, lower, higher) => {
      expect(idsOf(await search(query()))).toEqual([
        words[lower],
        words[higher],
      ]);
    },
  );

  it('lists a word without a Level after an HSK7_9 word', async () => {
    expect(idsOf(await search(`${meaningToken}nul`))).toEqual([
      words.levelHsk79,
      words.noLevel,
    ]);
  });

  it('still matches an accented backfill row with an accented query', async () => {
    expect(idsOf(await search('học'))).toContain(words.legacy);
  });
});
