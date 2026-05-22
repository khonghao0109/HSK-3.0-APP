import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

function loadLocalEnv() {
  const envPath = join(process.cwd(), '.env');

  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)\s*=\s*(.*)\s*$/);

    if (!match) {
      continue;
    }

    const key = match[1].trim();
    const value = match[2].trim().replace(/^['"]|['"]$/g, '');

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadLocalEnv();

const prisma = new PrismaClient();

async function main() {
  const level =
    (await prisma.level.findFirst({
      orderBy: {
        orderIndex: 'asc',
      },
      select: {
        id: true,
        name: true,
      },
    })) ??
    (await prisma.level.create({
      data: {
        name: 'HSK1',
        orderIndex: 1,
      },
      select: {
        id: true,
        name: true,
      },
    }));

  const lesson = await prisma.lesson.upsert({
    where: {
      slug: 'hsk-1-lesson-detail-test',
    },
    update: {
      title: 'Lesson 1',
      description: 'Seed data for lesson detail API testing',
      levelId: level.id,
      orderIndex: 1,
    },
    create: {
      title: 'Lesson 1',
      description: 'Seed data for lesson detail API testing',
      slug: 'hsk-1-lesson-detail-test',
      levelId: level.id,
      orderIndex: 1,
    },
    select: {
      id: true,
      title: true,
    },
  });

  const existingTopic = await prisma.topic.findFirst({
    where: {
      lessonId: lesson.id,
      title: 'Greetings',
    },
    select: {
      id: true,
    },
  });

  if (existingTopic) {
    await prisma.topic.update({
      where: {
        id: existingTopic.id,
      },
      data: {
        content: 'Practice saying hello and introducing yourself.',
        orderIndex: 1,
      },
    });
  } else {
    await prisma.topic.create({
      data: {
        lessonId: lesson.id,
        title: 'Greetings',
        content: 'Practice saying hello and introducing yourself.',
        orderIndex: 1,
      },
    });
  }

  await prisma.story.upsert({
    where: {
      slug: 'hsk-1-lesson-detail-story',
    },
    update: {
      levelId: level.id,
      title: 'A Simple Greeting',
      content: '你好！我是学生。',
    },
    create: {
      levelId: level.id,
      title: 'A Simple Greeting',
      content: '你好！我是学生。',
      slug: 'hsk-1-lesson-detail-story',
    },
  });

  const word = await prisma.word.upsert({
    where: {
      hanzi_pinyin: {
        hanzi: '你好',
        pinyin: 'ni hao',
      },
    },
    update: {
      pinyinTone: 'ni3 hao3',
      isPure: true,
    },
    create: {
      hanzi: '你好',
      pinyin: 'ni hao',
      pinyinTone: 'ni3 hao3',
      isPure: true,
    },
    select: {
      id: true,
    },
  });

  const existingMeaning = await prisma.wordMeaning.findFirst({
    where: {
      wordId: word.id,
      meaningEn: 'hello',
    },
    select: {
      id: true,
    },
  });

  if (!existingMeaning) {
    await prisma.wordMeaning.create({
      data: {
        wordId: word.id,
        meaningEn: 'hello',
        meaningVi: 'xin chao',
      },
    });
  }

  await prisma.wordLevel.upsert({
    where: {
      wordId_levelId: {
        wordId: word.id,
        levelId: level.id,
      },
    },
    update: {},
    create: {
      wordId: word.id,
      levelId: level.id,
    },
  });

  await prisma.lessonWord.upsert({
    where: {
      lessonId_wordId: {
        lessonId: lesson.id,
        wordId: word.id,
      },
    },
    update: {},
    create: {
      lessonId: lesson.id,
      wordId: word.id,
    },
  });

  console.log(
    JSON.stringify(
      {
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        testUrl: `http://localhost:3000/api/v1/lessons/${lesson.id}`,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
