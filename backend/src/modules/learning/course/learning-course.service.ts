import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { ApiSuccessResponse } from '../../../common/interfaces/api-response.interface';
import {
  buildAnyLessonReadyWhere,
  PUBLIC_CONTENT_WHERE,
} from '../../../common/policies/lesson-readiness.policy';
import { PrismaService } from '../../../prisma/prisma.service';
import type { LearningPathProgress } from '../path/learning-path.policy';
import {
  LearningCourseDetailResponseDto,
  LearningCourseEnrollmentResponseDto,
  LearningCourseListResponseDto,
  LearningCourseSummaryDto,
} from './dto/learning-course.dto';
import {
  buildCoursePath,
  resolveCurrentCourseCode,
} from './learning-course.policy';

const COURSE_NOT_FOUND = 'Course not found.';

const COURSE_SELECT = {
  id: true,
  code: true,
  kind: true,
  curriculumVersion: true,
  title: true,
  description: true,
} satisfies Prisma.CourseSelect;

type CourseRow = Prisma.CourseGetPayload<{ select: typeof COURSE_SELECT }>;

const ENROLLMENT_SELECT = {
  status: true,
  isCurrent: true,
  enrolledAt: true,
  leftAt: true,
  course: { select: { code: true } },
} satisfies Prisma.CourseEnrollmentSelect;

/**
 * Lessons a learner sees in a course: ready lessons, with or without a Level
 * (ADR-009 C3b-1), of published units of a published course.
 */
function courseLessonWhere(courseId?: number): Prisma.LessonWhereInput {
  return buildAnyLessonReadyWhere({
    courseUnit: {
      is: {
        ...PUBLIC_CONTENT_WHERE,
        course: {
          is: {
            ...PUBLIC_CONTENT_WHERE,
            ...(courseId === undefined ? {} : { id: courseId }),
          },
        },
      },
    },
  });
}

/**
 * ADR-009 C3a learner course routes. Reads never write; enrollment writes
 * touch only the caller's own rows and never Progress (Q-C5, Q-C6).
 */
@Injectable()
export class LearningCourseService {
  constructor(private readonly prisma: PrismaService) {}

  async listCourses(
    userId: number,
  ): Promise<ApiSuccessResponse<LearningCourseListResponseDto>> {
    const [courses, enrollments, lessons, done] = await Promise.all([
      this.prisma.course.findMany({
        where: PUBLIC_CONTENT_WHERE,
        orderBy: { orderIndex: 'asc' },
        select: COURSE_SELECT,
      }),
      this.loadEnrollments(userId),
      this.prisma.lesson.findMany({
        where: courseLessonWhere(),
        select: { courseUnit: { select: { courseId: true } } },
      }),
      this.prisma.progress.findMany({
        where: { userId, status: 'done', lesson: { is: courseLessonWhere() } },
        select: {
          lesson: { select: { courseUnit: { select: { courseId: true } } } },
        },
      }),
    ]);

    const count = (
      rows: Array<{ courseUnit: { courseId: number } | null }>,
    ) => {
      const byCourse = new Map<number, number>();
      for (const row of rows) {
        const id = row.courseUnit?.courseId;
        if (id !== undefined) byCourse.set(id, (byCourse.get(id) ?? 0) + 1);
      }
      return byCourse;
    };
    const totals = count(lessons);
    const completed = count(done.map((row) => row.lesson));
    const currentCode = this.currentCode(courses, enrollments);

    return {
      success: true,
      data: {
        courses: courses.map((course) =>
          this.toSummary(course, enrollments, currentCode, {
            completedLessons: completed.get(course.id) ?? 0,
            totalLessons: totals.get(course.id) ?? 0,
          }),
        ),
      },
    };
  }

  async getCourse(
    userId: number,
    code: string,
  ): Promise<ApiSuccessResponse<LearningCourseDetailResponseDto>> {
    const course = await this.findPublicCourse(this.prisma, code);
    const [units, lessons, progresses, enrollments, publishedCodes] =
      await Promise.all([
        this.prisma.courseUnit.findMany({
          where: { ...PUBLIC_CONTENT_WHERE, courseId: course.id },
          orderBy: { orderIndex: 'asc' },
          select: {
            id: true,
            orderIndex: true,
            title: true,
            gradeNumber: true,
            volume: true,
            level: { select: { code: true } },
          },
        }),
        this.prisma.lesson.findMany({
          where: courseLessonWhere(course.id),
          select: {
            id: true,
            courseUnitId: true,
            title: true,
            slug: true,
            orderIndex: true,
          },
        }),
        this.prisma.progress.findMany({
          where: { userId, lesson: { is: courseLessonWhere(course.id) } },
          select: {
            lessonId: true,
            status: true,
            completionPercent: true,
            lastActivityAt: true,
          },
        }),
        this.loadEnrollments(userId),
        this.prisma.course.findMany({
          where: PUBLIC_CONTENT_WHERE,
          select: { code: true },
        }),
      ]);

    const progressByLessonId = new Map<number, LearningPathProgress>(
      progresses.map(({ lessonId, ...progress }) => [lessonId, progress]),
    );
    const path = buildCoursePath(
      course.kind,
      units.map((unit) => ({
        id: unit.id,
        orderIndex: unit.orderIndex,
        lessons: lessons
          .filter((lesson) => lesson.courseUnitId === unit.id)
          .map((lesson) => ({
            id: lesson.id,
            title: lesson.title,
            slug: lesson.slug,
            orderIndex: lesson.orderIndex,
          })),
      })),
      progressByLessonId,
    );
    const unitById = new Map(units.map((unit) => [unit.id, unit]));
    const lessonCount = path.reduce(
      (sum, unit) => sum + unit.lessons.length,
      0,
    );
    const doneCount = path.reduce(
      (sum, unit) =>
        sum + unit.lessons.filter((lesson) => lesson.state === 'done').length,
      0,
    );
    const currentCode = resolveCurrentCourseCode(
      enrollments.map((enrollment) => ({
        courseCode: enrollment.course.code,
        status: enrollment.status,
        isCurrent: enrollment.isCurrent,
      })),
      new Set(publishedCodes.map((row) => row.code)),
    );

    return {
      success: true,
      data: {
        ...this.toSummary(course, enrollments, currentCode, {
          completedLessons: doneCount,
          totalLessons: lessonCount,
        }),
        units: path.map((unit) => {
          const meta = unitById.get(unit.id);
          return {
            orderIndex: unit.orderIndex,
            title: meta?.title ?? '',
            gradeNumber: meta?.gradeNumber ?? null,
            volume: meta?.volume ?? null,
            levelCode: meta?.level?.code ?? null,
            lessons: unit.lessons.map((lesson) => ({
              id: lesson.id,
              title: lesson.title,
              slug: lesson.slug,
              position: lesson.position,
              state: lesson.state,
              completionPercent: lesson.completionPercent,
            })),
          };
        }),
      },
    };
  }

  /** Idempotent: an active enrollment is left as is; a left one becomes active again. */
  async enroll(
    userId: number,
    code: string,
  ): Promise<ApiSuccessResponse<LearningCourseEnrollmentResponseDto>> {
    const enrollment = await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const course = await this.findPublicCourse(tx, code);
      return tx.courseEnrollment.upsert({
        where: { userId_courseId: { userId, courseId: course.id } },
        create: { userId, courseId: course.id, status: 'active' },
        update: { status: 'active', leftAt: null },
        select: ENROLLMENT_SELECT,
      });
    });
    return { success: true, data: this.toEnrollment(enrollment) };
  }

  /** Idempotent: only an active enrollment changes; rows and Progress stay (ADR-001). */
  async leave(userId: number, code: string): Promise<void> {
    const course = await this.findPublicCourse(this.prisma, code);
    await this.prisma.courseEnrollment.updateMany({
      where: { userId, courseId: course.id, status: 'active' },
      data: { status: 'left', leftAt: new Date(), isCurrent: false },
    });
  }

  /**
   * Moves `isCurrent` to the chosen course, enrolling when needed. The user
   * row lock serialises concurrent calls of one learner, so the partial
   * unique index on `isCurrent` never sees two current rows.
   */
  async setCurrent(
    userId: number,
    code: string,
  ): Promise<ApiSuccessResponse<LearningCourseEnrollmentResponseDto>> {
    const enrollment = await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const course = await this.findPublicCourse(tx, code);
      await tx.courseEnrollment.updateMany({
        where: { userId, isCurrent: true, NOT: { courseId: course.id } },
        data: { isCurrent: false },
      });
      return tx.courseEnrollment.upsert({
        where: { userId_courseId: { userId, courseId: course.id } },
        create: {
          userId,
          courseId: course.id,
          status: 'active',
          isCurrent: true,
        },
        update: { status: 'active', leftAt: null, isCurrent: true },
        select: ENROLLMENT_SELECT,
      });
    });
    return { success: true, data: this.toEnrollment(enrollment) };
  }

  /**
   * Serialises one learner's enrollment writes: the upsert with a nested
   * select is not a single INSERT … ON CONFLICT, so concurrent creates would
   * otherwise hit the unique index (P2002 → 500).
   */
  private async lockUser(
    tx: Prisma.TransactionClient,
    userId: number,
  ): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  }

  private async findPublicCourse(
    db: Pick<Prisma.TransactionClient, 'course'>,
    code: string,
  ): Promise<CourseRow> {
    const course = await db.course.findFirst({
      where: { ...PUBLIC_CONTENT_WHERE, code },
      select: COURSE_SELECT,
    });
    if (!course) throw new NotFoundException(COURSE_NOT_FOUND);
    return course;
  }

  private loadEnrollments(userId: number) {
    return this.prisma.courseEnrollment.findMany({
      where: { userId },
      select: { courseId: true, ...ENROLLMENT_SELECT },
    });
  }

  private currentCode(
    courses: readonly CourseRow[],
    enrollments: Awaited<ReturnType<LearningCourseService['loadEnrollments']>>,
  ): string | null {
    return resolveCurrentCourseCode(
      enrollments.map((enrollment) => ({
        courseCode: enrollment.course.code,
        status: enrollment.status,
        isCurrent: enrollment.isCurrent,
      })),
      new Set(courses.map((course) => course.code)),
    );
  }

  private toSummary(
    course: CourseRow,
    enrollments: Awaited<ReturnType<LearningCourseService['loadEnrollments']>>,
    currentCode: string | null,
    progress: { completedLessons: number; totalLessons: number },
  ): LearningCourseSummaryDto {
    return {
      code: course.code,
      kind: course.kind,
      curriculumVersion: course.curriculumVersion,
      title: course.title,
      description: course.description,
      enrolled: enrollments.some(
        (enrollment) =>
          enrollment.courseId === course.id && enrollment.status === 'active',
      ),
      isCurrent: course.code === currentCode,
      progress,
    };
  }

  private toEnrollment(
    row: Prisma.CourseEnrollmentGetPayload<{
      select: typeof ENROLLMENT_SELECT;
    }>,
  ): LearningCourseEnrollmentResponseDto {
    return {
      courseCode: row.course.code,
      status: row.status,
      isCurrent: row.isCurrent,
      enrolledAt: row.enrolledAt,
      leftAt: row.leftAt,
    };
  }
}
