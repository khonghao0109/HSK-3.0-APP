import { Prisma, PrismaClient } from '@prisma/client';

type SeedLearningTopicClient = Pick<PrismaClient, 'topic'>;

export function upsertSeedLearningTopic(
  prisma: SeedLearningTopicClient,
  input: {
    lessonId: number;
    title: string;
    orderIndex: number;
    content: Prisma.InputJsonValue;
  },
) {
  return prisma.topic.upsert({
    where: {
      lessonId_orderIndex: {
        lessonId: input.lessonId,
        orderIndex: input.orderIndex,
      },
    },
    update: {
      title: input.title,
      content: input.content,
      status: 'published',
      deletedAt: null,
    },
    create: {
      lessonId: input.lessonId,
      title: input.title,
      orderIndex: input.orderIndex,
      content: input.content,
      status: 'published',
    },
    select: { id: true },
  });
}
