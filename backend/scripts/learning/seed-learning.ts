import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const LESSONS_PER_LEVEL = 5;
const WORDS_PER_LESSON = 20;
const TEMP_LESSON_DESCRIPTION_PREFIX = 'Temporary lesson for testing';

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

function slugifyLevelName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function vocabularyOverviewContent() {
  return JSON.stringify([
    {
      type: 'text',
      value: 'This topic introduces the main vocabulary of this lesson.',
    },
    {
      type: 'vocabulary_list',
      value: 'lesson_words',
    },
  ]);
}

function practiceNotesContent() {
  return JSON.stringify([
    {
      type: 'text',
      value:
        'Practice reading, pronunciation, and basic usage of the lesson words.',
    },
  ]);
}

loadLocalEnv();

const prisma = new PrismaClient();

async function seedLearning() {
  const levels = await prisma.level.findMany({
    orderBy: {
      orderIndex: 'asc',
    },
    select: {
      id: true,
      name: true,
      orderIndex: true,
    },
  });

  if (levels.length === 0) {
    console.log('No levels found. Seed Level data before learning data.');
    return;
  }

  let lessonCount = 0;
  let topicCount = 0;
  let storyCount = 0;
  let lessonWordCount = 0;

  for (const level of levels) {
    const levelSlug = slugifyLevelName(level.name);

    const wordLevels = await prisma.wordLevel.findMany({
      where: {
        levelId: level.id,
      },
      orderBy: {
        wordId: 'asc',
      },
      take: LESSONS_PER_LEVEL * WORDS_PER_LESSON,
      select: {
        wordId: true,
      },
    });

    for (let lessonIndex = 1; lessonIndex <= LESSONS_PER_LEVEL; lessonIndex++) {
      const lessonSlug = `${levelSlug}-lesson-${lessonIndex}`;
      const lessonTitle = `${level.name} - Lesson ${lessonIndex}`;
      const lessonDescription = `${TEMP_LESSON_DESCRIPTION_PREFIX} ${level.name} learning flow.`;
      const wordIds = wordLevels
        .slice(
          (lessonIndex - 1) * WORDS_PER_LESSON,
          lessonIndex * WORDS_PER_LESSON,
        )
        .map((wordLevel) => wordLevel.wordId);

      const lesson = await prisma.lesson.upsert({
        where: {
          slug: lessonSlug,
        },
        update: {
          levelId: level.id,
          title: lessonTitle,
          description: lessonDescription,
          orderIndex: lessonIndex,
        },
        create: {
          levelId: level.id,
          title: lessonTitle,
          slug: lessonSlug,
          description: lessonDescription,
          orderIndex: lessonIndex,
        },
        select: {
          id: true,
        },
      });
      lessonCount += 1;

      await prisma.topic.deleteMany({
        where: {
          lessonId: lesson.id,
          title: {
            in: ['Vocabulary Overview', 'Practice Notes'],
          },
        },
      });

      await prisma.topic.createMany({
        data: [
          {
            lessonId: lesson.id,
            title: 'Vocabulary Overview',
            orderIndex: 1,
            content: vocabularyOverviewContent(),
          },
          {
            lessonId: lesson.id,
            title: 'Practice Notes',
            orderIndex: 2,
            content: practiceNotesContent(),
          },
        ],
      });
      topicCount += 2;

      if (wordIds.length > 0) {
        const lessonWords = wordIds.map((wordId) => ({
          lessonId: lesson.id,
          wordId,
        }));

        await prisma.lessonWord.createMany({
          data: lessonWords,
          skipDuplicates: true,
        });
        lessonWordCount += lessonWords.length;
      }
    }

    for (let storyIndex = 1; storyIndex <= 2; storyIndex++) {
      await prisma.story.upsert({
        where: {
          slug: `${levelSlug}-story-${storyIndex}`,
        },
        update: {
          levelId: level.id,
          title: `${level.name} Story ${storyIndex}`,
          content: `Temporary short story for ${level.name} reading practice.`,
        },
        create: {
          levelId: level.id,
          title: `${level.name} Story ${storyIndex}`,
          slug: `${levelSlug}-story-${storyIndex}`,
          content: `Temporary short story for ${level.name} reading practice.`,
        },
      });
      storyCount += 1;
    }

    console.log(
      `${level.name}: seeded ${LESSONS_PER_LEVEL} lessons, ${wordLevels.length} lesson words source links, 10 topics, 2 stories.`,
    );
  }

  console.log(
    JSON.stringify(
      {
        levels: levels.length,
        lessonsUpserted: lessonCount,
        topicsCreated: topicCount,
        storiesUpserted: storyCount,
        lessonWordMappingsAttempted: lessonWordCount,
      },
      null,
      2,
    ),
  );
}

seedLearning()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
