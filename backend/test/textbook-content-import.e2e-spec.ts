/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
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
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { importTextbookLesson } from '../src/modules/content-pilot/import-textbook-content';
import { spawn } from 'node:child_process';

import {
  importTextbookGrade,
  summarizeTextbookGrade,
  textbookSeeddataPaths,
} from '../src/modules/content-pilot/import-textbook-grade';
import {
  convertTextbookSeeddata,
  serializeTextbookLesson,
  TEXTBOOK_COURSE,
  TEXTBOOK_DATA_SOURCE,
} from '../src/modules/content-pilot/textbook-seeddata.converter';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

/**
 * M2.13a — profile `textbook` of the content importer, on the synthetic
 * fixture `test/fixtures/textbook` (never on seeddata). The suite owns the
 * HSK2_TEXTBOOK course of the disposable DB: no other suite uses that code or
 * the fixture hanzi 犇 骉 猋. `afterAll` archives the course tree and deletes
 * the words it created.
 */
describe('Textbook content import (M2.13a) E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let apiBaseUrl: string;
  let outDir: string;
  let existingWordId: number;
  const wordIdsToDelete: number[] = [];
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const password = 'StrongPassword123!';

  const lessonFile = (n: number) => join(outDir, `lesson-0${String(n)}.json`);
  // M2.13b: lessons 3–4 of the extended fixture (classroom phrases, exercises).
  const PHRASES = ['龘鱻！', '毳淼?', '焱垚。', '垚，焱'];
  const runExt = (n: number) =>
    importTextbookLesson(
      { apiBaseUrl, adminToken, prisma },
      {
        filePath: join(outDir, 'ext', `lesson-0${String(n)}.json`),
        dryRun: false,
      },
    );
  const run = (n: number, dryRun = false) =>
    importTextbookLesson(
      { apiBaseUrl, adminToken, prisma },
      { filePath: lessonFile(n), dryRun },
    );

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
    await app.init();
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    apiBaseUrl = `http://127.0.0.1:${String(address.port)}/api/v1`;
    prisma = app.get(PrismaService);

    const email = `textbook-admin-${suffix}@example.com`;
    const registered = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, name: 'Textbook admin' })
      .expect(201);
    await prisma.user.update({
      where: { id: registered.body.data.user.id as number },
      data: { role: 'admin' },
    });
    adminToken = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(201)
    ).body.data.accessToken as string;

    // The fixture's 犇 (bēn) is "already in the dictionary"; 骉 and 猋 are not.
    const existing = await prisma.word.create({
      data: {
        hanzi: '犇',
        pinyin: 'ben',
        pinyinNormalized: 'ben',
        status: 'published',
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    existingWordId = existing.id;
    wordIdsToDelete.push(existing.id);

    outDir = mkdtempSync('/tmp/hsk-textbook-e2e-');
    const fixture = (name: string) =>
      JSON.parse(
        readFileSync(join(__dirname, 'fixtures/textbook', name), 'utf8'),
      ) as unknown;
    for (const { fileName, content } of convertTextbookSeeddata({
      vocab: fixture('hsk1-vocab.json'),
      lessons: fixture('hsk1-lessons.json'),
      grade: 1,
      from: 1,
      to: 2,
    })) {
      writeFileSync(join(outDir, fileName), serializeTextbookLesson(content));
    }
    mkdirSync(join(outDir, 'ext'));
    for (const { fileName, content } of convertTextbookSeeddata({
      vocab: fixture('hsk1-ext-vocab.json'),
      lessons: fixture('hsk1-ext-lessons.json'),
      grade: 1,
      from: 3,
      to: 4,
    })) {
      writeFileSync(
        join(outDir, 'ext', fileName),
        serializeTextbookLesson(content),
      );
    }
  });

  afterAll(async () => {
    const course = await prisma.course.findUnique({
      where: { code: TEXTBOOK_COURSE.code },
      select: { id: true },
    });
    if (course !== null) {
      const lessons = await prisma.lesson.findMany({
        where: { courseUnit: { courseId: course.id } },
        select: { id: true },
      });
      const lessonIds = lessons.map((lesson) => lesson.id);
      const drafts = await prisma.lessonWord.findMany({
        where: { lessonId: { in: lessonIds } },
        select: { wordId: true },
      });
      wordIdsToDelete.push(...drafts.map((row) => row.wordId));
      await prisma.lessonWord.deleteMany({
        where: { lessonId: { in: lessonIds } },
      });
      const now = new Date();
      await prisma.lesson.updateMany({
        where: { id: { in: lessonIds } },
        data: { status: 'archived', deletedAt: now },
      });
      await prisma.courseUnit.updateMany({
        where: { courseId: course.id },
        data: { status: 'archived', deletedAt: now },
      });
      await prisma.course.update({
        where: { id: course.id },
        data: { status: 'archived', deletedAt: now },
      });
    }
    await prisma.word.deleteMany({
      where: { id: { in: [...new Set(wordIdsToDelete)] } },
    });
    rmSync(outDir, { recursive: true, force: true });
    await app.close();
  });

  it('[T1] has the textbook DataSource from the forward migration', async () => {
    await expect(
      prisma.dataSource.findUnique({
        where: { code: TEXTBOOK_DATA_SOURCE.code },
        select: { version: true, attribution: true },
      }),
    ).resolves.toMatchObject({
      version: TEXTBOOK_DATA_SOURCE.version,
      attribution: expect.not.stringMatching(/baolingo/i) as unknown,
    });
  });

  it('[T2] dry-run reads only and reports existing and draft words', async () => {
    const result = await run(1, true);
    expect(result).toMatchObject({
      dryRun: true,
      courseId: null,
      lessonId: null,
      wordCount: 2,
      existingWords: 1,
      draftWords: [{ hanzi: '骉', pinyin: 'biāo' }],
    });
    await expect(
      prisma.course.count({ where: { code: TEXTBOOK_COURSE.code } }),
    ).resolves.toBe(0);
    await expect(
      prisma.word.count({ where: { hanzi: { in: ['骉', '猋'] } } }),
    ).resolves.toBe(0);
  });

  it('[T3] creates the course, unit, two draft lessons without a Level and draft words', async () => {
    const first = await run(1);
    const second = await run(2);
    expect(first).toMatchObject({
      createdCourse: true,
      createdUnit: true,
      createdLesson: true,
      createdTopics: 3,
      lessonWordCount: 2,
    });
    expect(second).toMatchObject({
      createdCourse: false,
      createdUnit: false,
      createdLesson: true,
      createdTopics: 3,
      draftWords: [{ hanzi: '猋', pinyin: 'biāo' }],
    });

    const course = await prisma.course.findUniqueOrThrow({
      where: { code: TEXTBOOK_COURSE.code },
      select: {
        kind: true,
        curriculumVersion: true,
        status: true,
        units: {
          select: { gradeNumber: true, volume: true, levelId: true },
        },
      },
    });
    expect(course).toEqual({
      kind: 'textbook',
      curriculumVersion: 'HSK_2_0',
      status: 'draft',
      units: [{ gradeNumber: 1, volume: null, levelId: null }],
    });
    const lessons = await prisma.lesson.findMany({
      where: {
        id: { in: [first.lessonId as number, second.lessonId as number] },
      },
      orderBy: { orderIndex: 'asc' },
      select: {
        slug: true,
        status: true,
        levelId: true,
        courseUnitId: true,
        lessonWords: {
          orderBy: { orderIndex: 'asc' },
          select: { word: { select: { id: true, hanzi: true, status: true } } },
        },
      },
    });
    expect(lessons.map((lesson) => lesson.slug)).toEqual([
      'hsk2-textbook-g1-l01-chao-hoi-thu-nghiem',
      'hsk2-textbook-g1-l02-dem-so-don-gian',
    ]);
    for (const lesson of lessons) {
      expect(lesson).toMatchObject({
        status: 'draft',
        levelId: null,
        courseUnitId: first.unitId,
      });
    }
    const [l1, l2] = lessons.map((lesson) =>
      lesson.lessonWords.map(({ word }) => word),
    );
    expect(l1[0]).toEqual({
      id: existingWordId,
      hanzi: '犇',
      status: 'published',
    });
    expect(l2[1]).toEqual({
      id: existingWordId,
      hanzi: '犇',
      status: 'published',
    });
    expect([l1[1], l2[0]].map((word) => [word.hanzi, word.status])).toEqual([
      ['骉', 'draft'],
      ['猋', 'draft'],
    ]);
    const draft = await prisma.word.findUniqueOrThrow({
      where: { id: l1[1].id },
      select: {
        pinyin: true,
        meanings: {
          select: { meaningVi: true, dataSource: { select: { code: true } } },
        },
        sources: { select: { dataSource: { select: { code: true } } } },
      },
    });
    expect(draft).toEqual({
      pinyin: 'biao',
      meanings: [
        {
          meaningVi: 'ngựa chạy (từ thử)',
          dataSource: { code: TEXTBOOK_DATA_SOURCE.code },
        },
      ],
      sources: [{ dataSource: { code: TEXTBOOK_DATA_SOURCE.code } }],
    });
  });

  it('[T4] a second run creates nothing new', async () => {
    const counts = () =>
      Promise.all([
        prisma.course.count({ where: { code: TEXTBOOK_COURSE.code } }),
        prisma.courseUnit.count({
          where: { course: { code: TEXTBOOK_COURSE.code } },
        }),
        prisma.lesson.count({
          where: { courseUnit: { course: { code: TEXTBOOK_COURSE.code } } },
        }),
        prisma.topic.count({
          where: {
            lesson: { courseUnit: { course: { code: TEXTBOOK_COURSE.code } } },
          },
        }),
        prisma.word.count({ where: { hanzi: { in: ['犇', '骉', '猋'] } } }),
        prisma.lessonWord.count({
          where: {
            lesson: { courseUnit: { course: { code: TEXTBOOK_COURSE.code } } },
          },
        }),
      ]);
    const before = await counts();
    expect(before).toEqual([1, 1, 2, 6, 3, 4]);
    for (const n of [1, 2]) {
      expect(await run(n)).toMatchObject({
        createdCourse: false,
        createdUnit: false,
        createdLesson: false,
        createdTopics: 0,
        draftWords: [],
      });
    }
    expect(await counts()).toEqual(before);
  });

  it('[T5] publishes a lesson only once its words are published', async () => {
    const course = await prisma.course.findUniqueOrThrow({
      where: { code: TEXTBOOK_COURSE.code },
      select: { id: true, units: { select: { id: true } } },
    });
    const lesson = await prisma.lesson.findFirstOrThrow({
      where: { slug: 'hsk2-textbook-g1-l01-chao-hoi-thu-nghiem' },
      select: { id: true, lessonWords: { select: { wordId: true } } },
    });
    await prisma.topic.updateMany({
      where: { lessonId: lesson.id },
      data: { status: 'published', publishedAt: new Date() },
    });
    await admin(
      'post',
      `/admin/cms/course-units/${course.units[0].id}/publish`,
    ).expect(201);
    await admin('post', `/admin/cms/courses/${course.id}/publish`).expect(201);
    const revision = await prisma.contentRevision.findFirstOrThrow({
      where: { entityType: 'lesson', entityId: lesson.id },
      orderBy: { revision: 'desc' },
      select: { id: true },
    });
    await admin(
      'post',
      `/admin/cms/lessons/${lesson.id}/revisions/${revision.id}/reviews`,
    )
      .send({ decision: 'approved' })
      .expect(201);
    const publish = () =>
      admin(
        'post',
        `/admin/cms/lessons/${lesson.id}/revisions/${revision.id}/publish`,
      );

    const refused = await publish().expect(409);
    expect(refused.body.error.code).toBe('LESSON_WORDS_NOT_PUBLISHED');

    // No CMS route reviews a Word yet: approve the draft words directly.
    await prisma.word.updateMany({
      where: {
        id: { in: lesson.lessonWords.map((row) => row.wordId) },
        status: 'draft',
      },
      data: { status: 'published', publishedAt: new Date() },
    });
    expect((await publish().expect(201)).body.data.lesson.status).toBe(
      'published',
    );

    const seen = await request(app.getHttpServer())
      .get(`/api/v1/learning/courses/${TEXTBOOK_COURSE.code}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(
      (seen.body.data.units as Array<{ lessons: Array<{ id: number }> }>)
        .flatMap((unit) => unit.lessons)
        .map((row) => row.id),
    ).toEqual([lesson.id]);
  });

  const extState = () =>
    Promise.all([
      prisma.lessonExercise.findMany({
        where: { lesson: { slug: { startsWith: 'hsk2-textbook-g1-l03-' } } },
        orderBy: { orderIndex: 'asc' },
        select: { type: true, status: true, sourceKey: true, topicId: true },
      }),
      prisma.word.count({ where: { hanzi: { in: PHRASES } } }),
      prisma.lessonWord.count({
        where: { lesson: { slug: { startsWith: 'hsk2-textbook-g1-l04-' } } },
      }),
      prisma.lessonWord.count({
        where: { lesson: { slug: { startsWith: 'hsk2-textbook-g1-l03-' } } },
      }),
    ]);

  it('[T6] imports generated exercises as drafts and no Word for classroom phrases', async () => {
    const third = await runExt(3);
    const fourth = await runExt(4);
    expect(third).toMatchObject({
      createdLesson: true,
      wordCount: 6,
      classroomPhraseCount: 2,
      exerciseCount: 14,
      importedExercises: 14,
      exercisesIdempotent: false,
    });
    expect(fourth).toMatchObject({
      createdLesson: true,
      wordCount: 0,
      classroomPhraseCount: 2,
      exerciseCount: 0,
      importedExercises: 0,
      lessonWordCount: 0,
    });
    const [exercises, phraseWords, l4Words, l3Words] = await extState();
    expect(exercises).toHaveLength(14);
    expect(new Set(exercises.map((e) => e.status))).toEqual(new Set(['draft']));
    expect(exercises.filter((e) => e.type === 'matching')).toHaveLength(2);
    expect(exercises.filter((e) => e.type === 'mcq')).toHaveLength(12);
    expect(exercises[0].sourceKey).toBe('hsk2-textbook:g1:l03:e01');
    const vocabulary = await prisma.topic.findFirstOrThrow({
      where: {
        type: 'vocabulary',
        lesson: { slug: { startsWith: 'hsk2-textbook-g1-l03-' } },
      },
      select: { id: true },
    });
    expect(new Set(exercises.map((e) => e.topicId))).toEqual(
      new Set([vocabulary.id]),
    );
    expect([phraseWords, l4Words, l3Words]).toEqual([0, 0, 6]);
  });

  it('[T7] a second run creates no duplicate exercise', async () => {
    const before = await extState();
    const again = await runExt(3);
    expect(again).toMatchObject({
      createdLesson: false,
      importedExercises: 14,
      exercisesIdempotent: true,
    });
    await runExt(4);
    expect(await extState()).toEqual(before);
  });

  it('[T8] the whole-grade command converts every lesson and dry-runs them in order', async () => {
    const root = join(outDir, 'seeddata');
    const paths = textbookSeeddataPaths(root, 1);
    for (const [target, name] of [
      [paths.vocab, 'hsk1-ext-vocab.json'],
      [paths.lessons, 'hsk1-ext-lessons.json'],
    ] as const) {
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(
        target,
        readFileSync(join(__dirname, 'fixtures/textbook', name), 'utf8'),
      );
    }
    const before = await extState();
    const lessons = await importTextbookGrade(
      { apiBaseUrl, adminToken, prisma },
      {
        seeddataRoot: root,
        grade: 1,
        outRoot: join(outDir, 'grade'),
        dryRun: true,
      },
    );
    expect(
      lessons.map((l) => [
        l.fileName,
        l.wordCount,
        l.classroomPhraseCount,
        l.exerciseCount,
        l.skippedPublished,
        l.result?.dryRun ?? null,
      ]),
    ).toEqual([
      // Lesson 1 was published by T5: a rerun leaves it untouched.
      ['lesson-01.json', 2, 0, 4, true, null],
      ['lesson-02.json', 2, 0, 4, false, true],
      ['lesson-03.json', 6, 2, 14, false, true],
      ['lesson-04.json', 0, 2, 0, false, true],
    ]);
    expect(await extState()).toEqual(before);
  });

  // M2.13b FIX: a seeddata-shaped tree built from the extended fixture.
  const seeddataTree = (
    name: string,
    edit: (vocab: Array<Record<string, unknown>>) => void = () => undefined,
  ): string => {
    const root = join(outDir, name);
    const paths = textbookSeeddataPaths(root, 1);
    const read = (file: string) =>
      JSON.parse(
        readFileSync(join(__dirname, 'fixtures/textbook', file), 'utf8'),
      ) as Array<Record<string, unknown>>;
    const vocab = read('hsk1-ext-vocab.json');
    edit(vocab);
    for (const [target, value] of [
      [paths.vocab, vocab],
      [paths.lessons, read('hsk1-ext-lessons.json')],
    ] as const) {
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, JSON.stringify(value));
    }
    return root;
  };
  const publishGrade = (root: string) =>
    importTextbookGrade(
      { apiBaseUrl, adminToken, prisma },
      {
        seeddataRoot: root,
        grade: 1,
        outRoot: join(outDir, 'publish'),
        dryRun: false,
        publish: true,
      },
    );
  const courseState = () =>
    Promise.all([
      prisma.lesson.findMany({
        where: { courseUnit: { course: { code: TEXTBOOK_COURSE.code } } },
        orderBy: { orderIndex: 'asc' },
        select: { orderIndex: true, status: true },
      }),
      prisma.lessonExercise.groupBy({
        by: ['status'],
        where: {
          lesson: { courseUnit: { course: { code: TEXTBOOK_COURSE.code } } },
        },
        _count: true,
        orderBy: { status: 'asc' },
      }),
      prisma.contentRevision.count(),
      prisma.contentReview.count(),
      prisma.word.count({ where: { status: 'published' } }),
    ]);

  it('[T9] --publish publishes lessons without draft words and blocks the others', async () => {
    const wordsBefore = await prisma.word.count({
      where: { status: 'published' },
    });
    const lessons = await publishGrade(seeddataTree('publish-tree'));
    expect(
      lessons.map((l) => [l.fileName, l.status, l.draftWordCount]),
    ).toEqual([
      ['lesson-01.json', 'skipped_published', 0],
      ['lesson-02.json', 'blocked_draft_words', 1],
      ['lesson-03.json', 'blocked_draft_words', 6],
      ['lesson-04.json', 'published', 0],
    ]);
    expect(summarizeTextbookGrade(1, false, lessons)).toMatchObject({
      lessons: 4,
      published: 1,
      skippedPublished: 1,
      blockedDraftWords: 2,
      failed: 0,
    });
    // --publish never approves a Word.
    await expect(
      prisma.word.count({ where: { status: 'published' } }),
    ).resolves.toBe(wordsBefore);
    const fourth = await prisma.lesson.findFirstOrThrow({
      where: { slug: { startsWith: 'hsk2-textbook-g1-l04-' } },
      select: { id: true, status: true, topics: { select: { status: true } } },
    });
    expect(fourth.status).toBe('published');
    expect(fourth.topics.map((t) => t.status)).toEqual(['published']);
    const third = await prisma.lesson.findFirstOrThrow({
      where: { slug: { startsWith: 'hsk2-textbook-g1-l03-' } },
      select: { status: true, exercises: { select: { status: true } } },
    });
    expect(third.status).toBe('draft');
    expect(new Set(third.exercises.map((e) => e.status))).toEqual(
      new Set(['draft']),
    );
    const seen = await request(app.getHttpServer())
      .get(`/api/v1/learning/courses/${TEXTBOOK_COURSE.code}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(
      (seen.body.data.units as Array<{ lessons: Array<{ id: number }> }>)
        .flatMap((unit) => unit.lessons)
        .map((row) => row.id),
    ).toContain(fourth.id);
  });

  it('[T10] a second --publish run changes nothing', async () => {
    const before = await courseState();
    const lessons = await publishGrade(seeddataTree('publish-tree-2'));
    expect(lessons.map((l) => l.status)).toEqual([
      'skipped_published',
      'blocked_draft_words',
      'blocked_draft_words',
      'skipped_published',
    ]);
    expect(await courseState()).toEqual(before);
  });

  it('[T11] --continue-on-error records a failing lesson, goes on and exits 1', async () => {
    const root = seeddataTree('broken-tree', (vocab) => {
      vocab[1] = { ...vocab[1], tu_vung: [] };
    });
    const options = {
      seeddataRoot: root,
      grade: 1,
      outRoot: join(outDir, 'broken'),
      dryRun: true,
    };
    await expect(
      importTextbookGrade({ apiBaseUrl, adminToken, prisma }, options),
    ).rejects.toThrow();
    const lessons = await importTextbookGrade(
      { apiBaseUrl, adminToken, prisma },
      { ...options, continueOnError: true },
    );
    expect(lessons.map((l) => [l.fileName, l.status, l.errorCode])).toEqual([
      ['lesson-01.json', 'skipped_published', null],
      ['lesson-02.json', 'failed', 'lesson_empty'],
      ['lesson-03.json', 'dry_run', null],
      ['lesson-04.json', 'skipped_published', null],
    ]);
    // Async spawn: the API under test runs in this process and must keep serving.
    const cli = await new Promise<{ status: number | null; stdout: string }>(
      (resolveCli) => {
        const child = spawn(
          'npx',
          [
            'ts-node',
            'scripts/content/import-textbook-grade.ts',
            '--seeddata-root',
            root,
            '--grade',
            '1',
            '--dry-run',
            '--continue-on-error',
          ],
          {
            cwd: join(__dirname, '..'),
            env: {
              ...process.env,
              API_BASE_URL: apiBaseUrl,
              ADMIN_TOKEN: adminToken,
            },
          },
        );
        let stdout = '';
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf8');
        });
        child.on('close', (status) => resolveCli({ status, stdout }));
      },
    );
    expect(cli.status).toBe(1);
    const json = cli.stdout.slice(cli.stdout.indexOf('\n{') + 1);
    expect(JSON.parse(json)).toMatchObject({
      dryRun: true,
      lessons: 4,
      failed: 1,
      failures: [{ fileName: 'lesson-02.json', errorCode: 'lesson_empty' }],
    });
    expect(cli.stdout).not.toContain('Câu lớp thử');
  });

  function admin(method: 'get' | 'post', path: string) {
    return request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${adminToken}`);
  }
});
