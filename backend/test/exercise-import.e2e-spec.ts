/// <reference types="jest" />

import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { EXERCISE_IMPORT_V1_MAX_ROWS } from '../src/modules/cms/exercise-import/exercise-import.constants';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

type ImportRow = {
  sourceKey: string;
  lessonId: number;
  topicId: number | null;
  type: 'mcq' | 'listening_choice' | 'fill_blank' | 'arrange_sentence';
  prompt: string;
  content: Record<string, unknown>;
  answer: Record<string, unknown>;
  explanation: string | null;
  orderIndex: number;
  mediaId?: number;
  [key: string]: unknown;
};

type ImportPayload = {
  dataSourceId: number;
  fileName: string;
  rows: ImportRow[];
};

describe('Exercise Import Preview & Commit V1 E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let levelId: number;
  let lessonId: number;
  let topicId: number;
  let dataSourceId: number;
  let adminId: number;
  let adminToken: string;
  let normalToken: string;
  let committedPreviewHash: string;

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const password = 'StrongPassword123!';
  const fileName = `exercise-import-${suffix}.json`;
  const previewCorrelationId = randomUUID();

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
    prisma = app.get(PrismaService);

    const level = await prisma.level.upsert({
      where: { code: 'HSK1' },
      update: {},
      create: {
        code: 'HSK1',
        name: 'HSK1',
        orderIndex: 1,
        minBand: 1,
        maxBand: 1,
        curriculumVersion: 'HSK_3_0',
        status: 'published',
        publishedAt: new Date(),
      },
    });
    levelId = level.id;
    lessonId = (
      await prisma.lesson.create({
        data: {
          levelId,
          title: 'Exercise import lesson',
          slug: `exercise-import-${suffix}`,
          orderIndex: 800_000 + Math.floor(Math.random() * 100_000),
          status: 'published',
          publishedAt: new Date(),
        },
      })
    ).id;
    topicId = (
      await prisma.topic.create({
        data: {
          lessonId,
          title: 'Exercise import topic',
          content: [{ type: 'text', value: 'Import fixture.' }],
          orderIndex: 1,
          status: 'published',
          publishedAt: new Date(),
        },
      })
    ).id;
    dataSourceId = (
      await prisma.dataSource.create({
        data: {
          code: `EXERCISE_IMPORT_${suffix}`,
          name: `Exercise Import Fixture ${suffix}`,
          version: 'v1',
          license: 'test-only',
          contentHash: null,
        },
      })
    ).id;

    const normal = await register('normal');
    normalToken = normal.token;
    const admin = await register('admin');
    adminId = admin.userId;
    await prisma.user.update({
      where: { id: admin.userId },
      data: { role: 'admin' },
    });
    adminToken = await login(`import-admin-${suffix}@example.com`);
  });

  afterAll(async () => {
    if (lessonId) {
      const now = new Date();
      await prisma.lessonExercise.updateMany({
        where: { lessonId },
        data: { status: 'archived', deletedAt: now },
      });
      await prisma.topic.updateMany({
        where: { lessonId },
        data: { status: 'archived', deletedAt: now },
      });
      await prisma.lesson.update({
        where: { id: lessonId },
        data: { status: 'archived', deletedAt: now },
      });
    }
    await app.close();
  });

  it('1. protects preview and commit with authentication and admin RBAC', async () => {
    const payload = validPayload();
    await request(app.getHttpServer())
      .post('/api/v1/admin/cms/exercise-imports/preview')
      .send(payload)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/admin/cms/exercise-imports/preview')
      .set('Authorization', `Bearer ${normalToken}`)
      .send(payload)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/admin/cms/exercise-imports')
      .set('Authorization', `Bearer ${normalToken}`)
      .set('Idempotency-Key', 'import-rbac-denied-01')
      .send({ ...payload, previewHash: '0'.repeat(64) })
      .expect(403);
  });

  it('2. previews mixed rows deterministically without writing any table', async () => {
    const payload = mixedPayload();
    const before = await importCounts();
    const response = await preview(payload).expect(201);

    expect(response.body.data).toMatchObject({
      totalRows: 4,
      validRows: 0,
      invalidRows: 4,
      previewHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      errors: [
        expect.objectContaining({
          rowNumber: 1,
          path: 'sourceKey',
          code: 'DUPLICATE_SOURCE_KEY_IN_BATCH',
        }),
        expect.objectContaining({
          rowNumber: 2,
          path: 'sourceKey',
          code: 'DUPLICATE_SOURCE_KEY_IN_BATCH',
        }),
        expect.objectContaining({
          rowNumber: 3,
          path: 'answer.optionId',
          code: 'OPTION_ID_NOT_FOUND',
        }),
        expect.objectContaining({
          rowNumber: 4,
          path: '$.$unknown',
          code: 'UNEXPECTED_FIELD',
        }),
      ],
    });
    expect(await importCounts()).toEqual(before);
    expect(JSON.stringify(response.body)).not.toContain('postgresql://');
    expect(JSON.stringify(response.body)).not.toContain('optionId":"missing');
  });

  it('3. hashes the canonical payload and detects content changes without writes', async () => {
    const payload = validPayload();
    const before = await importCounts();
    const first = await preview(payload).expect(201);
    const canonicalRetry = await preview({
      rows: payload.rows.map((row) => ({ ...row })),
      fileName: payload.fileName,
      dataSourceId: payload.dataSourceId,
    }).expect(201);
    expect(canonicalRetry.body.data.previewHash).toBe(
      first.body.data.previewHash,
    );

    const changed = validPayload();
    changed.rows[0] = {
      ...changed.rows[0],
      prompt: 'Changed after preview',
    };
    const changedPreview = await preview(changed).expect(201);
    expect(changedPreview.body.data.previewHash).not.toBe(
      first.body.data.previewHash,
    );
    expect(await importCounts()).toEqual(before);
  });

  it('4. rejects a changed payload and an invalid preview atomically', async () => {
    const payload = validPayload();
    const validPreview = await preview(payload).expect(201);
    const before = await importCounts();
    const changed = validPayload();
    changed.rows[0] = { ...changed.rows[0], prompt: 'Changed after preview' };
    const mismatch = await commit(
      changed,
      validPreview.body.data.previewHash as string,
      'exercise-import-hash-mismatch-01',
    ).expect(409);
    expect(mismatch.body.error.message).toMatch(
      /preview.*match|payload.*changed/i,
    );
    expect(await importCounts()).toEqual(before);

    const invalidPayload = mixedPayload();
    const invalidPreview = await preview(invalidPayload).expect(201);
    await commit(
      invalidPayload,
      invalidPreview.body.data.previewHash as string,
      'exercise-import-invalid-batch-01',
    ).expect(422);
    expect(await importCounts()).toEqual(before);
  });

  it('5. commits an all-valid batch once and records provenance', async () => {
    const payload = validPayload();
    const previewResponse = await preview(payload).expect(201);
    expect(previewResponse.body.data).toMatchObject({
      totalRows: 2,
      validRows: 2,
      invalidRows: 0,
      errors: [],
    });
    const previewHash = previewResponse.body.data.previewHash as string;
    committedPreviewHash = previewHash;
    const committed = await commit(
      payload,
      previewHash,
      'exercise-import-commit-0001',
    ).expect(201);
    expect(committed.body.data).toMatchObject({
      idempotent: false,
      importedRows: 2,
      importJob: {
        status: 'completed',
        dataSourceId,
        fileName,
        fileChecksum: previewHash,
        totalRows: 2,
        validRows: 2,
        errorRows: 0,
        importedRows: 2,
      },
      exercises: [
        expect.objectContaining({ status: 'draft', version: 1 }),
        expect.objectContaining({ status: 'draft', version: 1 }),
      ],
    });

    const exerciseIds = committed.body.data.exercises.map(
      (exercise: { id: number }) => exercise.id,
    ) as number[];
    const provenance = await prisma.$queryRaw<
      Array<{ id: number; dataSourceId: number; sourceKey: string }>
    >(Prisma.sql`
      SELECT id, "dataSourceId", "sourceKey"
      FROM "LessonExercise"
      WHERE id IN (${Prisma.join(exerciseIds)})
      ORDER BY id
    `);
    expect(provenance).toHaveLength(2);
    expect(provenance.every((row) => row.dataSourceId === dataSourceId)).toBe(
      true,
    );
    expect(provenance.map((row) => row.sourceKey).sort()).toEqual(
      payload.rows.map((row) => row.sourceKey).sort(),
    );

    const revisions = await prisma.contentRevision.findMany({
      where: { entityType: 'lesson_exercise', entityId: { in: exerciseIds } },
      select: { entityId: true, revision: true, contentHash: true },
    });
    expect(revisions).toHaveLength(2);
    expect(
      revisions.every(
        (revision) =>
          revision.revision === 1 && revision.contentHash?.length === 64,
      ),
    ).toBe(true);

    const publicDetail = await request(app.getHttpServer())
      .get(`/api/v1/learning/lessons/${lessonId}`)
      .expect(200);
    expect(
      publicDetail.body.data.exercises.some((exercise: { id: number }) =>
        exerciseIds.includes(exercise.id),
      ),
    ).toBe(false);
  });

  it('6. retries the same idempotency key without duplicate jobs or exercises', async () => {
    const payload = validPayload();
    const retry = await commit(
      payload,
      committedPreviewHash,
      'exercise-import-commit-0001',
    ).expect(201);
    expect(retry.body.data).toMatchObject({
      idempotent: true,
      importedRows: 2,
      importJob: { idempotencyKey: 'exercise-import-commit-0001' },
    });
    await expect(
      prisma.importJob.count({
        where: {
          dataSourceId,
          idempotencyKey: 'exercise-import-commit-0001',
        },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.lessonExercise.count({ where: { lessonId } }),
    ).resolves.toBe(2);
  });

  it('7. rejects reusing an idempotency key for a different valid request', async () => {
    const different = validPayload({
      fileName: `exercise-import-different-${suffix}.json`,
      rows: [fillBlankRow(`import-fill-different-${suffix}`, 30)],
    });
    const differentPreview = await preview(different).expect(201);
    const before = await importCounts();
    const rejected = await commit(
      different,
      differentPreview.body.data.previewHash as string,
      'exercise-import-commit-0001',
    ).expect(409);
    expect(rejected.body.error.message).toMatch(/Idempotency-Key.*different/i);
    expect(await importCounts()).toEqual(before);
  });

  it('8. deterministically rejects a stable sourceKey that already exists', async () => {
    const duplicatePayload = validPayload({
      fileName: `exercise-import-duplicate-${suffix}.json`,
      rows: [validPayload().rows[0]],
    });
    const before = await importCounts();
    const response = await preview(duplicatePayload).expect(201);
    expect(response.body.data).toMatchObject({
      totalRows: 1,
      validRows: 0,
      invalidRows: 1,
      errors: [
        expect.objectContaining({
          rowNumber: 1,
          path: 'sourceKey',
          code: 'SOURCE_KEY_ALREADY_EXISTS',
        }),
      ],
    });
    expect(await importCounts()).toEqual(before);
  });

  it('9. rejects replay of incomplete or incoherent legacy import jobs', async () => {
    const payload = validPayload({
      fileName: `exercise-import-incomplete-${suffix}.json`,
      rows: [fillBlankRow(`import-incomplete-${suffix}`, 900)],
    });
    const previewResponse = await preview(payload).expect(201);
    const previewHash = previewResponse.body.data.previewHash as string;
    const idempotencyKey = `exercise-import-incomplete-${suffix}`;
    await prisma.importJob.create({
      data: {
        dataSourceId,
        createdById: adminId,
        entityType: 'lesson_exercise',
        status: 'pending',
        idempotencyKey,
        fileName: payload.fileName,
        fileChecksum: previewHash,
        totalRows: 1,
        validRows: 1,
        errorRows: 0,
        importedRows: 0,
        summary: {
          contractVersion: 'lesson-exercise-import-v1',
          sourceKeys: payload.rows.map((row) => row.sourceKey),
        },
        startedAt: new Date(),
      },
    });

    const rejected = await commit(payload, previewHash, idempotencyKey).expect(
      409,
    );
    expect(rejected.body.error.message).toMatch(/incomplete.*manual review/i);
    await expect(
      prisma.lessonExercise.count({
        where: { sourceKey: `import-incomplete-${suffix}` },
      }),
    ).resolves.toBe(0);

    const incoherentPayload = validPayload({
      fileName: `exercise-import-incoherent-${suffix}.json`,
      rows: [fillBlankRow(`import-expected-${suffix}`, 901)],
    });
    const incoherentPreview = await preview(incoherentPayload).expect(201);
    const incoherentHash = incoherentPreview.body.data.previewHash as string;
    const incoherentKey = `exercise-import-incoherent-${suffix}`;
    const startedAt = new Date();
    await prisma.importJob.create({
      data: {
        dataSourceId,
        createdById: adminId,
        entityType: 'lesson_exercise',
        status: 'completed',
        idempotencyKey: incoherentKey,
        fileName: incoherentPayload.fileName,
        fileChecksum: incoherentHash,
        totalRows: 1,
        validRows: 1,
        errorRows: 0,
        importedRows: 1,
        summary: {
          contractVersion: 'lesson-exercise-import-v1',
          sourceKeys: [`unrelated-${suffix}`],
        },
        startedAt,
        completedAt: new Date(startedAt.getTime() + 1),
      },
    });
    const incoherent = await commit(
      incoherentPayload,
      incoherentHash,
      incoherentKey,
    ).expect(409);
    expect(incoherent.body.error.message).toMatch(/incomplete.*manual review/i);
    await expect(
      prisma.lessonExercise.count({
        where: { sourceKey: `import-expected-${suffix}` },
      }),
    ).resolves.toBe(0);
  });

  it('10. commits the tested V1 maximum batch within the bounded transaction', async () => {
    const rows = Array.from(
      { length: EXERCISE_IMPORT_V1_MAX_ROWS },
      (_, index) =>
        fillBlankRow(`import-max-${suffix}-${index + 1}`, 1_000 + index),
    );
    const payload = validPayload({
      fileName: `exercise-import-max-${suffix}.json`,
      rows,
    });
    const previewResponse = await preview(payload).expect(201);
    expect(previewResponse.body.data).toMatchObject({
      totalRows: EXERCISE_IMPORT_V1_MAX_ROWS,
      validRows: EXERCISE_IMPORT_V1_MAX_ROWS,
      invalidRows: 0,
      errors: [],
    });

    const committed = await commit(
      payload,
      previewResponse.body.data.previewHash as string,
      `exercise-import-max-${suffix}`,
    ).expect(201);
    expect(committed.body.data).toMatchObject({
      idempotent: false,
      importedRows: EXERCISE_IMPORT_V1_MAX_ROWS,
      importJob: {
        status: 'completed',
        totalRows: EXERCISE_IMPORT_V1_MAX_ROWS,
        importedRows: EXERCISE_IMPORT_V1_MAX_ROWS,
      },
    });
    await expect(
      prisma.lessonExercise.count({
        where: {
          dataSourceId,
          sourceKey: { startsWith: `import-max-${suffix}-` },
        },
      }),
    ).resolves.toBe(EXERCISE_IMPORT_V1_MAX_ROWS);
  });

  function validPayload(overrides: Partial<ImportPayload> = {}): ImportPayload {
    return {
      dataSourceId,
      fileName,
      rows: [
        choiceRow(`import-choice-${suffix}`, 1),
        fillBlankRow(`import-fill-${suffix}`, 2),
      ],
      ...overrides,
    };
  }

  function mixedPayload(): ImportPayload {
    const valid = choiceRow(`mixed-choice-${suffix}`, 10);
    return {
      dataSourceId,
      fileName: `exercise-import-mixed-${suffix}.json`,
      rows: [
        valid,
        { ...valid, orderIndex: 11 },
        {
          ...choiceRow(`mixed-invalid-option-${suffix}`, 12),
          answer: { optionId: 'missing' },
        },
        {
          ...fillBlankRow(`mixed-unexpected-field-${suffix}`, 13),
          score: 100,
        },
      ],
    };
  }

  function choiceRow(sourceKey: string, orderIndex: number): ImportRow {
    return {
      sourceKey,
      lessonId,
      topicId,
      type: 'mcq',
      prompt: 'Choose 你好',
      content: {
        options: [
          { id: 'hello', text: '你好' },
          { id: 'bye', text: '再见' },
        ],
      },
      answer: { optionId: 'hello' },
      explanation: '你好 is correct.',
      orderIndex,
    };
  }

  function fillBlankRow(sourceKey: string, orderIndex: number): ImportRow {
    return {
      sourceKey,
      lessonId,
      topicId: null,
      type: 'fill_blank',
      prompt: 'Type 你好',
      content: {},
      answer: { acceptedTexts: ['你好'], caseSensitive: false },
      explanation: null,
      orderIndex,
    };
  }

  function preview(payload: ImportPayload) {
    return request(app.getHttpServer())
      .post('/api/v1/admin/cms/exercise-imports/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Request-Id', previewCorrelationId)
      .send(payload);
  }

  function commit(
    payload: ImportPayload,
    previewHash: string,
    idempotencyKey: string,
  ) {
    return request(app.getHttpServer())
      .post('/api/v1/admin/cms/exercise-imports')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ ...payload, previewHash });
  }

  async function importCounts() {
    const [exercises, jobs, rowErrors, audits] = await Promise.all([
      prisma.lessonExercise.count({ where: { lessonId } }),
      prisma.importJob.count({ where: { dataSourceId } }),
      prisma.importRowError.count({
        where: { importJob: { dataSourceId } },
      }),
      prisma.auditLog.count({
        where: {
          targetType: { in: ['exercise_import', 'exercise_import_job'] },
          correlationId: previewCorrelationId,
        },
      }),
    ]);
    return { exercises, jobs, rowErrors, audits };
  }

  async function register(label: string) {
    const email = `import-${label}-${suffix}@example.com`;
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, name: `Import ${label}` })
      .expect(201);
    return {
      userId: response.body.data.user.id as number,
      token: response.body.data.accessToken as string,
    };
  }

  async function login(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    return response.body.data.accessToken as string;
  }
});
