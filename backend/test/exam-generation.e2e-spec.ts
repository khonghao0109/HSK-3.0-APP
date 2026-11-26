/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ContentStatus, QuestionType, Skill } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import {
  type BlueprintFile,
  importBlueprints,
  validateBlueprintFile,
} from '../src/modules/content-hsk1/exam-blueprint';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

type GeneratedData = {
  blueprintCode: string;
  seed: string;
  parts: { key: string; setId: number | null; questionIds: number[] }[];
  test: {
    id: number;
    status: string;
    title: string;
    duration: number;
    passScore: number | null;
    questionCount: number;
    sections: {
      skill: string;
      groups: {
        title: string | null;
        imageId: number | null;
        questions: { questionId: number; status: string }[];
      }[];
    }[];
  };
};

/** Q357: blueprint → sinh đề draft từ ngân hàng câu hỏi. */
describe('Exam generation from blueprints (Q357)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let suffix: string;
  let adminToken: string;
  let learnerToken: string;
  let levelId: number;
  let blueprintCode: string;
  let singleFormat: string;
  let setFormat: string;
  const imageIds: number[] = [];
  const singles: number[] = [];
  let draftSingle: number;
  const setIds: number[] = [];
  const password = 'StrongPassword123!';
  const testIds: number[] = [];
  const questionIds: number[] = [];

  beforeAll(async () => {
    assertDisposableTestDatabase();
    suffix = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
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

    const level = await prisma.level.upsert({
      where: { code: 'HSK3' },
      update: {},
      create: {
        code: 'HSK3',
        name: 'HSK3',
        orderIndex: 3,
        minBand: 3,
        maxBand: 3,
        curriculumVersion: 'HSK_3_0',
        status: ContentStatus.published,
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    levelId = level.id;

    const admin = await register('admin');
    await prisma.user.update({
      where: { id: admin.userId },
      data: { role: 'admin' },
    });
    adminToken = await login(`exam-gen-admin-${suffix}@example.com`);
    learnerToken = (await register('learner')).token;

    // Format = tag slug riêng cho lần chạy này: các spec khác dùng chung cấp không lọt vào pool.
    singleFormat = `gen-single-${suffix}`;
    setFormat = `gen-set-${suffix}`;
    blueprintCode = `gen-e2e-${suffix}`;

    for (let i = 0; i < 6; i += 1)
      singles.push(
        await seedQuestion(singleFormat, ContentStatus.published, (i % 3) + 1),
      );
    draftSingle = await seedQuestion(singleFormat, ContentStatus.draft, 1);
    for (let s = 0; s < 2; s += 1) {
      const image = await prisma.media.create({
        data: {
          url: `https://cdn.example.test/exam-gen/${suffix}/set-${s}.png`,
          type: 'image',
          mimeType: 'image/png',
          processingStatus: 'ready',
        },
        select: { id: true },
      });
      imageIds.push(image.id);
      const members = [
        await seedQuestion(setFormat, ContentStatus.published, 2),
        await seedQuestion(setFormat, ContentStatus.published, 1),
      ];
      const set = await prisma.questionSet.create({
        data: {
          sourceKey: `exam-gen:${suffix}:set-${s}`,
          levelId,
          skill: Skill.reading,
          format: setFormat,
          imageId: image.id,
          status: ContentStatus.published,
          items: {
            create: members.map((questionId, orderIndex) => ({
              questionId,
              orderIndex,
            })),
          },
        },
        select: { id: true },
      });
      setIds.push(set.id);
    }

    const file: BlueprintFile = {
      schemaVersion: 1,
      blueprints: [
        {
          code: blueprintCode,
          level: 'HSK3',
          title: 'Đề sinh tự động e2e',
          instruction: 'Hướng dẫn đề e2e',
          durationMinutes: 25,
          passScore: 60,
          version: 1,
          status: 'draft',
          sections: [
            {
              skill: 'reading',
              title: 'Đọc',
              instruction: null,
              parts: [
                {
                  key: 'a',
                  title: 'Phần 1',
                  instruction: 'Câu lẻ',
                  questionType: 'mcq',
                  format: singleFormat,
                  questionCount: 3,
                  fromSet: false,
                },
                {
                  key: 'b',
                  title: 'Phần 2',
                  instruction: 'Bộ câu dùng chung tranh',
                  questionType: 'mcq',
                  format: setFormat,
                  questionCount: 2,
                  fromSet: true,
                },
              ],
            },
          ],
        },
      ],
    };
    expect(validateBlueprintFile(file)).toEqual([]);
    expect(await importBlueprints(prisma, file)).toEqual({
      [blueprintCode]: 'created',
    });
    expect(await importBlueprints(prisma, file)).toEqual({
      [blueprintCode]: 'unchanged',
    });
  });

  afterAll(async () => {
    try {
      if (prisma) {
        if (testIds.length > 0) {
          await prisma.testQuestionPlacement.deleteMany({
            where: { testId: { in: testIds } },
          });
          await prisma.testQuestion.deleteMany({
            where: { testId: { in: testIds } },
          });
          await prisma.questionGroup.deleteMany({
            where: { testId: { in: testIds } },
          });
          await prisma.testSection.deleteMany({
            where: { testId: { in: testIds } },
          });
          await prisma.test.deleteMany({ where: { id: { in: testIds } } });
        }
        await prisma.questionSet.deleteMany({ where: { id: { in: setIds } } });
        await prisma.examBlueprint.deleteMany({
          where: { code: blueprintCode },
        });
        await prisma.question.updateMany({
          where: { id: { in: questionIds } },
          data: { status: ContentStatus.archived, deletedAt: new Date() },
        });
        await prisma.media.updateMany({
          where: { id: { in: imageIds } },
          data: { deletedAt: new Date() },
        });
      }
    } finally {
      await app?.close();
    }
  });

  it('is admin-only and no-store', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/cms/tests/generate')
      .send({ blueprintCode })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/admin/cms/tests/generate')
      .set('Authorization', `Bearer ${learnerToken}`)
      .send({ blueprintCode })
      .expect(403);
    const missing = await generate({
      blueprintCode: 'khong-co-blueprint',
    }).expect(404);
    expect(missing.headers['cache-control']).toContain('no-store');
    expect(missing.body.error.code).toBe('BLUEPRINT_NOT_FOUND');
    await generate({ blueprintCode: 'Sai Định Dạng' }).expect(400);
  });

  it('creates a draft test from published questions and a whole set, reproducibly', async () => {
    const first = await generate({ blueprintCode, seed: 'seed-1' }).expect(201);
    const data = first.body.data as GeneratedData;
    testIds.push(data.test.id);
    expect(data.seed).toBe('seed-1');
    expect(data.test).toMatchObject({
      status: 'draft',
      title: 'Đề sinh tự động e2e · seed-1',
      duration: 25,
      passScore: 60,
      questionCount: 5,
    });
    const [partA, partB] = data.parts;
    expect(partA?.questionIds).toHaveLength(3);
    expect(partA?.questionIds.every((id) => singles.includes(id))).toBe(true);
    expect(partA?.questionIds).not.toContain(draftSingle);
    expect(setIds).toContain(partB?.setId);
    const groups = data.test.sections[0]?.groups ?? [];
    expect(groups.map((group) => group.title)).toEqual(['Phần 1', 'Phần 2']);
    expect(imageIds).toContain(groups[1]?.imageId);
    const stored = await prisma.test.findUniqueOrThrow({
      where: { id: data.test.id },
      select: { generationSeed: true, blueprint: { select: { code: true } } },
    });
    expect(stored).toEqual({
      generationSeed: 'seed-1',
      blueprint: { code: blueprintCode },
    });
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'test.generated', targetId: String(data.test.id) },
    });
    expect(audit).not.toBeNull();

    // Cùng seed nhưng câu đã được dùng ở đề 1 → ưu tiên câu ít dùng: khác đề 1.
    const second = await generate({
      blueprintCode,
      seed: 'seed-2',
      excludeTestIds: [data.test.id],
    }).expect(201);
    const next = second.body.data as GeneratedData;
    testIds.push(next.test.id);
    const overlap = next.parts[0]?.questionIds.filter((id) =>
      partA?.questionIds.includes(id),
    );
    expect(overlap).toEqual([]);
    expect(next.parts[1]?.setId).not.toBe(partB?.setId);

    const exhausted = await generate({
      blueprintCode,
      excludeTestIds: [data.test.id, next.test.id],
    }).expect(422);
    expect(exhausted.body.error).toMatchObject({
      code: 'BLUEPRINT_POOL_INSUFFICIENT',
    });
    expect(
      await prisma.test.count({
        where: { blueprint: { code: blueprintCode } },
      }),
    ).toBe(2);
  });

  it('can include draft questions for a preview', async () => {
    const preview = await generate({
      blueprintCode,
      seed: 'preview',
      includeDraft: true,
      title: 'Xem trước',
    }).expect(201);
    const data = preview.body.data as GeneratedData;
    testIds.push(data.test.id);
    expect(data.test.title).toBe('Xem trước');
    expect(data.parts[0]?.questionIds).toHaveLength(3);
  });

  function generate(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/v1/admin/cms/tests/generate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
  }

  async function seedQuestion(
    format: string,
    status: ContentStatus,
    difficulty: number,
  ): Promise<number> {
    const tag = await prisma.tag.upsert({
      where: { slug: format },
      update: {},
      create: { name: format, slug: format },
      select: { id: true },
    });
    const question = await prisma.question.create({
      data: {
        content: `Câu sinh đề ${format} ${questionIds.length}`,
        type: QuestionType.mcq,
        skill: Skill.reading,
        levelId,
        answers: {
          options: [
            { id: 'a', text: 'Đúng' },
            { id: 'b', text: 'Sai' },
          ],
        },
        correctAnswer: { optionId: 'a' },
        explanation: 'Giải thích.',
        difficulty,
        status,
        ...(status === ContentStatus.published
          ? { publishedAt: new Date() }
          : {}),
        tags: { create: { tagId: tag.id } },
      },
      select: { id: true },
    });
    questionIds.push(question.id);
    return question.id;
  }

  async function register(label: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: `exam-gen-${label}-${suffix}@example.com`,
        password,
        name: `Exam Gen ${label}`,
      })
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
