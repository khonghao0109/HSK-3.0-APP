/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { importPilotLesson } from '../src/modules/content-pilot/import-pilot-content';
import {
  derivePilotLessonNumber,
  normalizePinyinForCompare,
  stripToneMarks,
} from '../src/modules/content-pilot/pilot-content.validator';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

/**
 * M2.9a Pha 2 — e2e cho script nạp nội dung pilot (item 6).
 *
 * Chạy trên database disposable (guard `assertDisposableTestDatabase`). Kiểm:
 * - Q178: migration forward tạo `DataSource` `HSK30_PILOT_ORIGINAL_V1`;
 * - nạp `lesson-01` hai lần: lần 2 `idempotent: true`, không nhân bản
 *   Lesson/Topic/Exercise/LessonWord;
 * - lesson không còn `draft` → fail-fast, không ghi gì;
 * - preview có lỗi khác `SOURCE_KEY_ALREADY_EXISTS` → dừng trước commit;
 * - `--dry-run` chỉ đọc, 0 ghi.
 */

const BACKEND_ROOT = join(__dirname, '..');
const LESSON_FILE = join(
  BACKEND_ROOT,
  'content',
  'pilot',
  'hsk1',
  'lesson-01.json',
);
const PILOT_DATA_SOURCE_CODE = 'HSK30_PILOT_ORIGINAL_V1';
const LESSON_LEVEL_CODE = 'HSK1';

interface PilotLessonShape {
  readonly lesson: {
    readonly slug: string;
    readonly title: string;
    readonly orderIndex: number;
  };
  readonly words: readonly {
    readonly hanzi: string;
    readonly pinyin: string;
  }[];
  readonly topics: readonly { readonly key: string }[];
  readonly exercises: readonly { readonly sourceKey: string }[];
}

interface Counters {
  readonly lessons: number;
  readonly topics: number;
  readonly exercises: number;
  readonly lessonWords: number;
}

describe('Nạp nội dung pilot HSK1 (M2.9a Pha 2) E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let apiBaseUrl: string;
  let lesson: PilotLessonShape;
  let createdWordIds: number[];

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const password = 'StrongPassword123!';

  async function registerAdmin(): Promise<number> {
    const email = `pilot-content-admin-${suffix}@example.com`;
    const registered = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, name: 'Pilot content admin' })
      .expect(201);
    const userId = registered.body.data.user.id as number;
    await prisma.user.update({
      where: { id: userId },
      data: { role: 'admin' },
    });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    adminToken = login.body.data.accessToken as string;
    return userId;
  }

  async function ensurePublishedHsk1Level(): Promise<number> {
    const existing = await prisma.level.findUnique({
      where: { code: LESSON_LEVEL_CODE },
      select: { id: true, status: true },
    });
    if (existing === null) {
      const created = await prisma.level.create({
        data: {
          name: 'HSK1',
          code: LESSON_LEVEL_CODE,
          orderIndex: 1,
          minBand: 1,
          maxBand: 1,
          status: 'published',
          publishedAt: new Date(),
        },
        select: { id: true },
      });
      return created.id;
    }
    if (existing.status !== 'published') {
      await prisma.level.update({
        where: { id: existing.id },
        data: { status: 'published', publishedAt: new Date() },
      });
    }
    return existing.id;
  }

  async function seedPilotWords(): Promise<void> {
    createdWordIds = [];
    for (const word of lesson.words) {
      const toneless = normalizePinyinForCompare(stripToneMarks(word.pinyin));
      const where = {
        hanzi_pinyin: { hanzi: word.hanzi, pinyin: toneless },
      } as const;
      const existing = await prisma.word.findUnique({
        where,
        select: { id: true },
      });
      if (existing !== null) continue;
      const created = await prisma.word.create({
        data: {
          hanzi: word.hanzi,
          pinyin: toneless,
          pinyinNormalized: toneless,
          status: 'published',
          publishedAt: new Date(),
        },
        select: { id: true },
      });
      createdWordIds.push(created.id);
    }
  }

  async function counters(): Promise<Counters> {
    const [lessons, topics, exercises, lessonWords] = await Promise.all([
      prisma.lesson.count({ where: { slug: lesson.lesson.slug } }),
      prisma.topic.count({
        where: { lesson: { slug: lesson.lesson.slug } },
      }),
      prisma.lessonExercise.count({
        where: { lesson: { slug: lesson.lesson.slug } },
      }),
      prisma.lessonWord.count({
        where: { lesson: { slug: lesson.lesson.slug } },
      }),
    ]);
    return { lessons, topics, exercises, lessonWords };
  }

  function importOnce(dryRun: boolean) {
    return importPilotLesson(
      { apiBaseUrl, adminToken, prisma, logger: () => undefined },
      { filePath: LESSON_FILE, backendRoot: BACKEND_ROOT, dryRun },
    );
  }

  beforeAll(async () => {
    assertDisposableTestDatabase();
    lesson = JSON.parse(readFileSync(LESSON_FILE, 'utf8')) as PilotLessonShape;

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
    await app.init();
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    apiBaseUrl = `${await app.getUrl()}/api/v1`;

    await ensurePublishedHsk1Level();
    await registerAdmin();
    await seedPilotWords();
    // `LessonExercise` là archive-only (trigger chặn DELETE vật lý), nên suite
    // không dọn được lesson của lần chạy trước. Database phải mới tinh cho mỗi
    // lần chạy — đúng quy ước e2e của repo (`pretest:e2e` dựng lại DB mặc định).
    const staleLessons = await prisma.lesson.count({
      where: { slug: lesson.lesson.slug },
    });
    if (staleLessons > 0) {
      throw new Error(
        `Database disposable chưa sạch: đã có lesson slug=${lesson.lesson.slug}. ` +
          'Dùng database mới cho mỗi lần chạy (pretest:e2e tự dựng lại DB mặc định).',
      );
    }
  });

  afterAll(async () => {
    // Chỉ xoá được resource không bị trigger archive-only chặn. Lesson/Topic/
    // Exercise của pilot nằm lại trong database disposable (đã bị drop/rebuild
    // ở lần chạy sau) — không ảnh hưởng dữ liệu công khai vì mọi bản ghi `draft`.
    try {
      if (prisma !== undefined) {
        await prisma.lessonWord.deleteMany({
          where: { lesson: { slug: lesson.lesson.slug } },
        });
        if (createdWordIds.length > 0) {
          await prisma.word.deleteMany({
            where: { id: { in: createdWordIds } },
          });
        }
        await prisma.importJob.deleteMany({
          where: { fileName: 'lesson-01.json' },
        });
      }
    } finally {
      if (app !== undefined) await app.close();
    }
  });

  it('1. Q178: migration forward tạo DataSource pilot với provenance trung thực', async () => {
    const source = await prisma.dataSource.findUnique({
      where: { code: PILOT_DATA_SOURCE_CODE },
      select: {
        name: true,
        version: true,
        license: true,
        attribution: true,
      },
    });
    expect(source).not.toBeNull();
    expect(source?.version).toBe('1.0.0');
    expect(source?.name).toBe('HSK 3.0 pilot content (AI-authored)');
    expect(source?.license).toBe('Original content authored for HSK 3.0 APP');
    expect(source?.attribution).toContain('AI-authored draft');
  });

  it('2. --dry-run chỉ đọc: 0 ghi Lesson/Topic/Exercise/LessonWord', async () => {
    const before = await counters();
    const result = await importOnce(true);
    expect(result.dryRun).toBe(true);
    expect(result.importedRows).toBe(0);
    expect(result.lessonId).toBeNull();
    expect(result.steps).toEqual(
      expect.arrayContaining(['validated', 'preflight', 'dry-run']),
    );
    expect(await counters()).toEqual(before);
  });

  it('3. nạp lần 1: Lesson + 3 Topic + 10 Exercise + 20 LessonWord, tất cả draft', async () => {
    const result = await importOnce(false);
    expect(result.dryRun).toBe(false);
    expect(result.createdLesson).toBe(true);
    expect(result.createdTopics).toBe(3);
    expect(result.importedRows).toBe(10);
    expect(result.lessonWordCount).toBe(20);
    expect(result.idempotent).toBe(false);
    expect(result.topicIds).toEqual({
      t01: expect.any(Number) as number,
      t02: expect.any(Number) as number,
      t03: expect.any(Number) as number,
    });

    const stored = await prisma.lesson.findUnique({
      where: { slug: lesson.lesson.slug },
      select: {
        id: true,
        status: true,
        orderIndex: true,
        topics: { select: { status: true } },
        exercises: { select: { status: true, sourceKey: true } },
        lessonWords: { select: { orderIndex: true } },
      },
    });
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe('draft');
    expect(stored?.orderIndex).toBe(
      1000 + (derivePilotLessonNumber('lesson-01.json') ?? 0),
    );
    expect(stored?.topics.every((topic) => topic.status === 'draft')).toBe(
      true,
    );
    expect(stored?.exercises).toHaveLength(10);
    expect(
      stored?.exercises.every((exercise) => exercise.status === 'draft'),
    ).toBe(true);
    expect(stored?.lessonWords).toHaveLength(20);
    expect(
      (stored?.lessonWords ?? [])
        .map((word) => word.orderIndex)
        .sort((left, right) => left - right),
    ).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
  });

  it('4. nạp lần 2: idempotent, không nhân bản bản ghi nào', async () => {
    const before = await counters();
    const firstJob = await prisma.importJob.findFirst({
      where: { fileName: 'lesson-01.json' },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    const result = await importOnce(false);
    expect(result.idempotent).toBe(true);
    expect(result.createdLesson).toBe(false);
    expect(result.createdTopics).toBe(0);
    expect(result.importedRows).toBe(10);
    expect(result.lessonWordCount).toBe(20);
    expect(await counters()).toEqual(before);
    const job = await prisma.importJob.findFirst({
      where: { fileName: 'lesson-01.json' },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    expect(job?.id).toBe(firstJob?.id);
  });

  it('5. preview có lỗi khác SOURCE_KEY_ALREADY_EXISTS → dừng, không ghi', async () => {
    const before = await counters();
    const originalFetch = globalThis.fetch;
    const wrapped: typeof fetch = async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes('/admin/cms/exercise-imports/preview')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              totalRows: lesson.exercises.length,
              validRows: lesson.exercises.length - 1,
              invalidRows: 1,
              errors: [{ rowNumber: 1, code: 'INVALID_ROW', path: '$.type' }],
              previewHash: 'a'.repeat(64),
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return originalFetch(input, init);
    };
    try {
      await expect(
        importPilotLesson(
          {
            apiBaseUrl,
            adminToken,
            prisma,
            logger: () => undefined,
            fetchImpl: wrapped,
          },
          { filePath: LESSON_FILE, backendRoot: BACKEND_ROOT, dryRun: false },
        ),
      ).rejects.toMatchObject({ code: 'exercise_preview_invalid' });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(await counters()).toEqual(before);
  });

  it('6. lesson không còn draft → fail-fast, không ghi gì', async () => {
    const before = await counters();
    const stored = await prisma.lesson.findUnique({
      where: { slug: lesson.lesson.slug },
      select: { id: true },
    });
    expect(stored).not.toBeNull();
    await prisma.lesson.update({
      where: { id: stored?.id ?? 0 },
      data: { status: 'published', publishedAt: new Date() },
    });
    try {
      await expect(importOnce(false)).rejects.toMatchObject({
        code: 'lesson_not_draft',
      });
    } finally {
      await prisma.lesson.update({
        where: { id: stored?.id ?? 0 },
        data: { status: 'draft', publishedAt: null },
      });
    }
    expect(await counters()).toEqual(before);
  });
  it('7. commit gặp 503 → retry tối đa 2 lần với cùng Idempotency-Key (§3.3)', async () => {
    const before = await counters();
    const originalFetch = globalThis.fetch;
    let commitAttempts = 0;
    const keysSeen: (string | null)[] = [];
    const wrapped: typeof fetch = async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.endsWith('/admin/cms/exercise-imports')) {
        commitAttempts += 1;
        const headers = new Headers(init?.headers);
        keysSeen.push(headers.get('idempotency-key'));
        if (commitAttempts === 1) {
          return new Response(
            JSON.stringify({
              success: false,
              error: {
                code: 'SERVICE_UNAVAILABLE',
                message:
                  'Exercise import is temporarily unavailable; retry the request.',
              },
            }),
            { status: 503, headers: { 'content-type': 'application/json' } },
          );
        }
      }
      return originalFetch(input, init);
    };
    try {
      const result = await importPilotLesson(
        {
          apiBaseUrl,
          adminToken,
          prisma,
          logger: () => undefined,
          fetchImpl: wrapped,
        },
        { filePath: LESSON_FILE, backendRoot: BACKEND_ROOT, dryRun: false },
      );
      expect(commitAttempts).toBe(2);
      expect(new Set(keysSeen).size).toBe(1);
      expect(result.idempotent).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(await counters()).toEqual(before);
  });

  it('8. guard FOR UPDATE: lesson bị publish sau preflight → không ghi LessonWord', async () => {
    const before = await counters();
    const auditBefore = await prisma.auditLog.count({
      where: { action: 'lesson_word.import_pilot' },
    });
    const stored = await prisma.lesson.findUnique({
      where: { slug: lesson.lesson.slug },
      select: { id: true },
    });
    expect(stored).not.toBeNull();
    const lessonId = stored?.id ?? 0;
    const originalFetch = globalThis.fetch;
    const wrapped: typeof fetch = async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const response = await originalFetch(input, init);
      if (url.endsWith('/admin/cms/exercise-imports')) {
        // Mô phỏng race: CMS publish lesson xen giữa preflight và bước ghi
        // LessonWord. Guard `SELECT … FOR UPDATE` phải chặn, tx rollback.
        await prisma.lesson.update({
          where: { id: lessonId },
          data: { status: 'published', publishedAt: new Date() },
        });
      }
      return response;
    };
    try {
      await expect(
        importPilotLesson(
          {
            apiBaseUrl,
            adminToken,
            prisma,
            logger: () => undefined,
            fetchImpl: wrapped,
          },
          { filePath: LESSON_FILE, backendRoot: BACKEND_ROOT, dryRun: false },
        ),
      ).rejects.toMatchObject({ code: 'lesson_not_draft' });
    } finally {
      globalThis.fetch = originalFetch;
      await prisma.lesson.update({
        where: { id: lessonId },
        data: { status: 'draft', publishedAt: null },
      });
    }
    expect(
      await prisma.auditLog.count({
        where: { action: 'lesson_word.import_pilot' },
      }),
    ).toBe(auditBefore);
    expect(await counters()).toEqual(before);
  });
});
