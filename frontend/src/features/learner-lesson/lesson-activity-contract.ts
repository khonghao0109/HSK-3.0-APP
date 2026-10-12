import { z } from 'zod';

import { lessonStateSchema } from '@/features/learner-path/learning-path-contract';
import { backendEnvelope } from '@/lib/api/backend-envelope';

const countSchema = z.number().int().nonnegative();

/**
 * The part of `GET /learning/lessons/:lessonId/activity` the lesson page
 * reads (M2.B13, Q43); other fields of the response are dropped.
 */
export const lessonActivitySchema = z.object({
  lesson: z.object({
    id: z.number().int(),
    title: z.string(),
    description: z.string().nullable(),
  }),
  progress: z.object({
    completionPercent: z.number(),
    // Read by the complete page (M2.5d, Q59).
    status: z.enum(['not_started', 'learning', 'done']),
    score: z.number().nullable(),
  }),
  level: z.object({ id: z.number().int(), code: z.string(), name: z.string() }),
  position: z.number().int().positive(),
  state: lessonStateSchema,
  sections: z.object({
    vocabulary: z.object({
      wordCount: countSchema,
      topicCount: countSchema,
      topicsDone: countSchema,
    }),
    grammar: z.object({ topicCount: countSchema, topicsDone: countSchema }),
    practice: z.object({ exerciseCount: countSchema, attempted: countSchema }),
  }),
});
export type LessonActivity = z.infer<typeof lessonActivitySchema>;

export const backendLessonActivitySchema =
  backendEnvelope(lessonActivitySchema);
