import { createHash } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

import { assertDisposableTestDatabase } from '../../src/common/utils/assert-disposable-test-database';

const prisma = new PrismaClient();
const REQUIRED_EMPTY_TABLES = [
  'User',
  'Level',
  'Lesson',
  'Topic',
  'LessonExercise',
  'ContentRevision',
  'ContentReview',
  'Media',
] as const;

function canonicalHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function assertMigrationOnlyFixtureState(): Promise<void> {
  const counts = await Promise.all([
    prisma.user.count(),
    prisma.level.count(),
    prisma.lesson.count(),
    prisma.topic.count(),
    prisma.lessonExercise.count(),
    prisma.contentRevision.count(),
    prisma.contentReview.count(),
    prisma.media.count(),
  ]);
  const nonempty = REQUIRED_EMPTY_TABLES.filter(
    (_, index) => counts[index] !== 0,
  );
  if (nonempty.length > 0) {
    throw new Error(
      'Frontend console seed requires a fresh migration-only disposable database.',
    );
  }
}

async function passwordHash(password: string): Promise<string> {
  const pepper = process.env.AUTH_PASSWORD_PEPPER;
  if (!pepper || pepper.length < 16) {
    throw new Error('Frontend console seed requires AUTH_PASSWORD_PEPPER.');
  }
  return argon2.hash(`${password}${pepper}`, {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
  });
}

async function main(): Promise<void> {
  const target = assertDisposableTestDatabase();
  await assertMigrationOnlyFixtureState();

  const adminEmail =
    process.env.E2E_ADMIN_EMAIL ?? 'admin.frontend@example.test';
  const adminPassword =
    process.env.E2E_ADMIN_PASSWORD ?? 'FrontendTest-Admin-123';
  const userEmail = process.env.E2E_USER_EMAIL ?? 'user.frontend@example.test';
  const userPassword = process.env.E2E_USER_PASSWORD ?? 'FrontendTest-User-123';
  const [adminHash, userHash] = await Promise.all([
    passwordHash(adminPassword),
    passwordHash(userPassword),
  ]);

  await prisma.$transaction(async (tx) => {
    const admin = await tx.user.create({
      data: {
        email: adminEmail,
        password: adminHash,
        name: 'Lin Qiao',
        role: 'admin',
        status: 'active',
        emailVerifiedAt: new Date(),
      },
    });
    await tx.user.create({
      data: {
        email: userEmail,
        password: userHash,
        name: 'Learner Fixture',
        role: 'user',
        status: 'active',
        emailVerifiedAt: new Date(),
      },
    });
    const source = await tx.dataSource.create({
      data: {
        code: 'FRONTEND_CONSOLE_V1',
        name: 'HSK 3.0 editorial corpus',
        version: '2026.08',
        license: 'Internal QA fixture',
        createdById: admin.id,
      },
    });
    const level = await tx.level.create({
      data: {
        code: 'HSK1',
        name: 'HSK 1',
        orderIndex: 1,
        minBand: 1,
        maxBand: 1,
        curriculumVersion: 'HSK_3_0',
        status: 'published',
        dataSourceId: source.id,
        createdById: admin.id,
        updatedById: admin.id,
        publishedById: admin.id,
        publishedAt: new Date(),
      },
    });
    const lesson = await tx.lesson.create({
      data: {
        levelId: level.id,
        title: 'Greetings & first meetings',
        description: 'Foundational greetings in everyday contexts.',
        slug: 'greetings-first-meetings',
        orderIndex: 1,
        status: 'published',
        dataSourceId: source.id,
        createdById: admin.id,
        updatedById: admin.id,
        publishedById: admin.id,
        publishedAt: new Date(),
      },
    });
    const topic = await tx.topic.create({
      data: {
        lessonId: lesson.id,
        title: 'Saying hello',
        subtitle: 'Core social exchange',
        content: [{ type: 'text', value: '你好！很高兴认识你。' }],
        orderIndex: 1,
        status: 'published',
        dataSourceId: source.id,
        createdById: admin.id,
        updatedById: admin.id,
        publishedById: admin.id,
        publishedAt: new Date(),
      },
    });
    const audio = await tx.media.create({
      data: {
        url: 'https://cdn.example.test/hsk/frontend-console/nihao.mp3',
        type: 'audio',
        mimeType: 'audio/mpeg',
        size: 16384,
        duration: 7,
        originalFilename: 'nihao-listening.mp3',
        processingStatus: 'ready',
        dataSourceId: source.id,
        uploadedById: admin.id,
        updatedById: admin.id,
      },
    });
    await tx.media.createMany({
      data: [
        {
          url: 'https://cdn.example.test/hsk/frontend-console/greetings.png',
          type: 'image',
          mimeType: 'image/png',
          size: 32768,
          originalFilename: 'greetings-cover.png',
          processingStatus: 'pending',
          dataSourceId: source.id,
          uploadedById: admin.id,
          updatedById: admin.id,
        },
        {
          url: 'https://cdn.example.test/hsk/frontend-console/legacy.pdf',
          type: 'pdf',
          mimeType: 'application/pdf',
          size: 65536,
          originalFilename: 'legacy-handout.pdf',
          processingStatus: 'failed',
          dataSourceId: source.id,
          uploadedById: admin.id,
          updatedById: admin.id,
        },
      ],
    });

    const fixtures: Array<{
      type: 'mcq' | 'listening_choice' | 'fill_blank';
      prompt: string;
      content: Prisma.InputJsonValue;
      answer: Prisma.InputJsonValue;
      explanation: string;
      status: 'published' | 'draft';
      mediaId?: number;
      sourceKey: string;
    }> = [
      {
        type: 'mcq',
        prompt: 'Choose the meaning of 你好',
        content: {
          options: [
            { id: 'hello', text: 'Hello' },
            { id: 'thanks', text: 'Thank you' },
          ],
        },
        answer: { optionId: 'hello' },
        explanation: '你好 is the standard greeting “hello”.',
        status: 'published',
        sourceKey: 'hsk1.greetings.mcq.hello',
      },
      {
        type: 'listening_choice',
        prompt: 'Listen and choose the greeting you hear',
        content: {
          options: [
            { id: 'nihao', text: '你好' },
            { id: 'zaijian', text: '再见' },
          ],
        },
        answer: { optionId: 'nihao' },
        explanation: 'The recording says 你好.',
        status: 'published',
        mediaId: audio.id,
        sourceKey: 'hsk1.greetings.listening.nihao',
      },
      {
        type: 'fill_blank',
        prompt: 'Complete the greeting: 你__',
        content: { acceptedForms: ['好'] },
        answer: { text: '好' },
        explanation: '你好 combines 你 and 好.',
        status: 'draft',
        sourceKey: 'hsk1.greetings.fill.nihao',
      },
    ];

    for (const [index, fixture] of fixtures.entries()) {
      const version = 1;
      const publishedAt = fixture.status === 'published' ? new Date() : null;
      const exercise = await tx.lessonExercise.create({
        data: {
          lessonId: lesson.id,
          topicId: topic.id,
          mediaId: fixture.mediaId ?? null,
          type: fixture.type,
          prompt: fixture.prompt,
          content: fixture.content,
          answer: fixture.answer,
          explanation: fixture.explanation,
          version,
          orderIndex: index + 1,
          status: fixture.status,
          dataSourceId: source.id,
          sourceKey: fixture.sourceKey,
          createdById: admin.id,
          updatedById: admin.id,
          publishedById: fixture.status === 'published' ? admin.id : null,
          publishedAt,
        },
      });
      const snapshot = {
        type: fixture.type,
        prompt: fixture.prompt,
        content: fixture.content,
        answer: fixture.answer,
        explanation: fixture.explanation,
        mediaId: fixture.mediaId ?? null,
        orderIndex: index + 1,
      };
      const revision = await tx.contentRevision.create({
        data: {
          entityType: 'lesson_exercise',
          entityId: exercise.id,
          revision: version,
          snapshot,
          contentHash: canonicalHash(snapshot),
          authorId: admin.id,
        },
      });
      if (fixture.status === 'published') {
        await tx.contentReview.create({
          data: {
            revisionId: revision.id,
            reviewerId: admin.id,
            decision: 'approved',
            note: 'Approved for frontend console verification.',
          },
        });
      }
    }
  });

  console.log(
    `Frontend console fixture created in disposable database ${target.databaseName}.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Frontend console seed failed.',
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
