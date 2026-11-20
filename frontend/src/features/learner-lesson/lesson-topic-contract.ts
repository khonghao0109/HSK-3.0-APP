import { z } from 'zod';

import { lessonStateSchema } from '@/features/learner-path/learning-path-contract';
import { backendEnvelope } from '@/lib/api/backend-envelope';

const progressStatusSchema = z.enum(['not_started', 'learning', 'done']);

/** The part of `GET /learning/lessons/:id/activity` the topic pages read (M2.5f). */
export const lessonTopicActivitySchema = z.object({
  lesson: z.object({ id: z.number().int(), title: z.string() }),
  level: z.object({ code: z.string() }),
  state: lessonStateSchema,
  topics: z.array(
    z.object({
      id: z.number().int(),
      title: z.string(),
      subtitle: z.string().nullable(),
      type: z.string(),
      // Read defensively by `topicBlocks`.
      content: z.unknown(),
      orderIndex: z.number().int(),
      progress: z.object({ status: progressStatusSchema }),
    }),
  ),
});
export type LessonTopicActivity = z.infer<typeof lessonTopicActivitySchema>;

export const backendLessonTopicActivitySchema = backendEnvelope(
  lessonTopicActivitySchema,
);

/** Words of `GET /learning/lessons/:id` for the `vocabulary_list` block. */
export const lessonWordsSchema = z.object({
  words: z.array(
    z.object({
      id: z.number().int(),
      // Lesson units: topic (đơn vị) of the word; vắng (bản cũ) = chưa gán.
      topicId: z.number().int().nullable().default(null),
      hanzi: z.string(),
      pinyin: z.string(),
      pinyinTone: z.string().nullable(),
      meanings: z.array(
        z.object({ vi: z.string().nullable(), en: z.string().nullable() }),
      ),
      // Q350: ảnh của từ.
      image: z
        .object({
          id: z.number().int().positive(),
          altText: z.string().nullable(),
        })
        .nullable()
        .default(null),
    }),
  ),
});
export type LessonWords = z.infer<typeof lessonWordsSchema>;

export const backendLessonWordsSchema = backendEnvelope(lessonWordsSchema);
