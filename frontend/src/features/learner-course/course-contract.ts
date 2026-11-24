import { z } from 'zod';

import { backendEnvelope } from '@/lib/api/backend-envelope';

import { COURSE_CODE_PATTERN } from './course-model';

// Server-only (Zod): docs/api/api.md A.7c. Client components import the
// Zod-free types of course-model.ts, never this module.

const count = z.number().int().nonnegative();

const courseSummarySchema = z.object({
  code: z.string().regex(COURSE_CODE_PATTERN),
  kind: z.enum(['topic', 'textbook', 'specialty']),
  curriculumVersion: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  enrolled: z.boolean(),
  isCurrent: z.boolean(),
  progress: z.object({ completedLessons: count, totalLessons: count }),
});

const courseLessonSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  slug: z.string(),
  position: z.number().int().positive(),
  state: z.enum(['done', 'current', 'available', 'locked']),
  completionPercent: z.number().min(0).max(100),
});

const courseUnitSchema = z.object({
  orderIndex: z.number().int(),
  title: z.string(),
  gradeNumber: z.number().int().nullable(),
  volume: z.enum(['upper', 'lower']).nullable(),
  levelCode: z.string().nullable(),
  lessons: z.array(courseLessonSchema),
});

export const courseListEnvelopeSchema = backendEnvelope(
  z.object({ courses: z.array(courseSummarySchema) }),
);
export const courseDetailEnvelopeSchema = backendEnvelope(
  courseSummarySchema.extend({ units: z.array(courseUnitSchema) }),
);
export const courseEnrollmentEnvelopeSchema = backendEnvelope(
  z.object({
    courseCode: z.string(),
    status: z.enum(['active', 'left']),
    isCurrent: z.boolean(),
    enrolledAt: z.string(),
    leftAt: z.string().nullable(),
  }),
);
export const currentCourseInputSchema = z
  .object({ courseCode: z.string().regex(COURSE_CODE_PATTERN) })
  .strict();
