import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import { lockActiveCmsActor } from './cms-actor-lock';
import {
  assertAdminActor,
  classifyCmsPersistenceError,
  CmsActor,
} from './cms-workflow';
import {
  AdminCourseUnitsQueryDto,
  AdminCoursesQueryDto,
  CreateCourseDto,
  CreateCourseUnitDto,
  UpdateCourseDto,
  UpdateCourseUnitDto,
} from './dto/course-authoring.dto';

type MutationContext = { correlationId: string };

const COURSE_ADMIN_SELECT = {
  id: true,
  code: true,
  kind: true,
  curriculumVersion: true,
  title: true,
  description: true,
  orderIndex: true,
  status: true,
  keyTextVisible: true,
  publishedAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CourseSelect;

const UNIT_ADMIN_SELECT = {
  id: true,
  courseId: true,
  orderIndex: true,
  gradeNumber: true,
  volume: true,
  title: true,
  levelId: true,
  status: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CourseUnitSelect;

type CourseRow = Prisma.CourseGetPayload<{
  select: typeof COURSE_ADMIN_SELECT;
}>;
type UnitRow = Prisma.CourseUnitGetPayload<{
  select: typeof UNIT_ADMIN_SELECT;
}>;

/**
 * ADR-009 C3b-2: CMS for Course and CourseUnit. Follows the Lesson pattern
 * (admin actor, mutation error mapping, audit, idempotent publish/archive) and
 * the Test PATCH pattern (row lock + `expectedUpdatedAt`).
 */
@Injectable()
export class CourseAuthoringService {
  constructor(private readonly prisma: PrismaService) {}

  async listCourses(actor: CmsActor, query: AdminCoursesQueryDto) {
    assertAdminActor(actor);
    const where: Prisma.CourseWhereInput = {
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.curriculumVersion
        ? { curriculumVersion: query.curriculumVersion }
        : {}),
    };
    const [courses, total] = await this.prisma.$transaction([
      this.prisma.course.findMany({
        where,
        orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: COURSE_ADMIN_SELECT,
      }),
      this.prisma.course.count({ where }),
    ]);
    return {
      success: true as const,
      data: courses,
      meta: pageMeta(query, total),
    };
  }

  async getCourse(actor: CmsActor, courseId: number) {
    assertAdminActor(actor);
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: {
        ...COURSE_ADMIN_SELECT,
        // Shortcut: a course has tens of units; paginate past ~200.
        units: {
          orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
          select: UNIT_ADMIN_SELECT,
        },
      },
    });
    if (!course) throw new NotFoundException('Course not found.');
    return { success: true as const, data: course };
  }

  async createCourse(
    actor: CmsActor,
    dto: CreateCourseDto,
    context: MutationContext,
  ) {
    assertAdminActor(actor);
    return this.executeMutation(() =>
      this.prisma.$transaction(async (tx) => {
        await lockActiveCmsActor(tx, actor.id);
        const course = await tx.course.create({
          data: {
            code: dto.code,
            kind: dto.kind,
            curriculumVersion: dto.curriculumVersion ?? null,
            title: dto.title,
            description: dto.description ?? null,
            orderIndex: dto.orderIndex,
            keyTextVisible: dto.keyTextVisible ?? true,
            status: 'draft',
          },
          select: COURSE_ADMIN_SELECT,
        });
        await this.audit(tx, actor.id, context, 'course.created', 'course', {
          after: course,
        });
        return { success: true as const, data: course };
      }),
    );
  }

  async updateCourse(
    actor: CmsActor,
    courseId: number,
    dto: UpdateCourseDto,
    context: MutationContext,
  ) {
    assertAdminActor(actor);
    return this.executeMutation(() =>
      this.prisma.$transaction(async (tx) => {
        const course = await this.lockCourse(tx, actor.id, courseId);
        assertNotArchived(course, 'Course');
        assertExpectedUpdatedAt(course.updatedAt, dto.expectedUpdatedAt);
        const data = changedFields(course, {
          title: dto.title,
          description: dto.description,
          orderIndex: dto.orderIndex,
          keyTextVisible: dto.keyTextVisible,
        });
        if (Object.keys(data).length === 0) {
          return { success: true as const, data: course };
        }
        const updated = await tx.course.update({
          where: { id: courseId },
          data,
          select: COURSE_ADMIN_SELECT,
        });
        // One row per PATCH; the copyright switch gets its own action so a
        // review of `keyTextVisible` changes is a single filter.
        const action =
          data.keyTextVisible !== undefined
            ? 'course.key_text_visibility_changed'
            : 'course.updated';
        await this.audit(tx, actor.id, context, action, 'course', {
          before: pick(course, Object.keys(data)),
          after: pick(updated, Object.keys(data)),
          id: courseId,
        });
        return { success: true as const, data: updated };
      }),
    );
  }

  async publishCourse(
    actor: CmsActor,
    courseId: number,
    context: MutationContext,
  ) {
    return this.setCourseStatus(actor, courseId, context, 'published');
  }

  async archiveCourse(
    actor: CmsActor,
    courseId: number,
    context: MutationContext,
  ) {
    return this.setCourseStatus(actor, courseId, context, 'archived');
  }

  async listUnits(actor: CmsActor, query: AdminCourseUnitsQueryDto) {
    assertAdminActor(actor);
    const where: Prisma.CourseUnitWhereInput = { courseId: query.courseId };
    const [units, total] = await this.prisma.$transaction([
      this.prisma.courseUnit.findMany({
        where,
        orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: UNIT_ADMIN_SELECT,
      }),
      this.prisma.courseUnit.count({ where }),
    ]);
    return {
      success: true as const,
      data: units,
      meta: pageMeta(query, total),
    };
  }

  async createUnit(
    actor: CmsActor,
    dto: CreateCourseUnitDto,
    context: MutationContext,
  ) {
    assertAdminActor(actor);
    return this.executeMutation(() =>
      this.prisma.$transaction(async (tx) => {
        const course = await this.lockCourse(tx, actor.id, dto.courseId);
        assertNotArchived(course, 'Course');
        const shape = {
          gradeNumber: dto.gradeNumber ?? null,
          volume: dto.volume ?? null,
          levelId: dto.levelId ?? null,
        };
        await this.assertUnitShape(tx, course.kind, shape);
        const unit = await tx.courseUnit.create({
          data: {
            courseId: dto.courseId,
            orderIndex: dto.orderIndex,
            title: dto.title,
            ...shape,
            status: 'draft',
          },
          select: UNIT_ADMIN_SELECT,
        });
        await this.audit(
          tx,
          actor.id,
          context,
          'course_unit.created',
          'course_unit',
          { after: unit },
        );
        return { success: true as const, data: unit };
      }),
    );
  }

  async updateUnit(
    actor: CmsActor,
    unitId: number,
    dto: UpdateCourseUnitDto,
    context: MutationContext,
  ) {
    assertAdminActor(actor);
    return this.executeMutation(() =>
      this.prisma.$transaction(async (tx) => {
        const { unit, course } = await this.lockUnit(tx, actor.id, unitId);
        assertNotArchived(course, 'Course');
        assertNotArchived(unit, 'Course unit');
        assertExpectedUpdatedAt(unit.updatedAt, dto.expectedUpdatedAt);
        const data = changedFields(unit, {
          orderIndex: dto.orderIndex,
          title: dto.title,
          gradeNumber: dto.gradeNumber,
          volume: dto.volume,
          levelId: dto.levelId,
        });
        if (Object.keys(data).length === 0) {
          return { success: true as const, data: unit };
        }
        await this.assertUnitShape(tx, course.kind, {
          gradeNumber:
            data.gradeNumber === undefined
              ? unit.gradeNumber
              : data.gradeNumber,
          volume: data.volume === undefined ? unit.volume : data.volume,
          levelId: data.levelId === undefined ? unit.levelId : data.levelId,
        });
        if (
          data.levelId !== undefined &&
          (await tx.lesson.count({ where: { courseUnitId: unitId } })) > 0
        ) {
          throw new ConflictException({
            code: 'COURSE_UNIT_HAS_LESSONS',
            message: 'The Level of a unit with lessons cannot change.',
          });
        }
        const updated = await tx.courseUnit.update({
          where: { id: unitId },
          data,
          select: UNIT_ADMIN_SELECT,
        });
        await this.audit(
          tx,
          actor.id,
          context,
          'course_unit.updated',
          'course_unit',
          {
            before: pick(unit, Object.keys(data)),
            after: pick(updated, Object.keys(data)),
            id: unitId,
          },
        );
        return { success: true as const, data: updated };
      }),
    );
  }

  async publishUnit(actor: CmsActor, unitId: number, context: MutationContext) {
    return this.setUnitStatus(actor, unitId, context, 'published');
  }

  async archiveUnit(actor: CmsActor, unitId: number, context: MutationContext) {
    return this.setUnitStatus(actor, unitId, context, 'archived');
  }

  private async setCourseStatus(
    actor: CmsActor,
    courseId: number,
    context: MutationContext,
    status: 'published' | 'archived',
  ) {
    assertAdminActor(actor);
    return this.executeMutation(() =>
      this.prisma.$transaction(async (tx) => {
        const course = await this.lockCourse(tx, actor.id, courseId);
        if (isArchived(course) || course.status === status) {
          if (status === 'published' && isArchived(course)) {
            assertNotArchived(course, 'Course');
          }
          return {
            success: true as const,
            data: { course, idempotent: true },
          };
        }
        const updated = await tx.course.update({
          where: { id: courseId },
          data: statusData(status),
          select: COURSE_ADMIN_SELECT,
        });
        await this.audit(tx, actor.id, context, `course.${status}`, 'course', {
          before: { status: course.status },
          after: { status: updated.status },
          id: courseId,
        });
        return {
          success: true as const,
          data: { course: updated, idempotent: false },
        };
      }),
    );
  }

  private async setUnitStatus(
    actor: CmsActor,
    unitId: number,
    context: MutationContext,
    status: 'published' | 'archived',
  ) {
    assertAdminActor(actor);
    return this.executeMutation(() =>
      this.prisma.$transaction(async (tx) => {
        const { unit } = await this.lockUnit(tx, actor.id, unitId);
        if (isArchived(unit) || unit.status === status) {
          if (status === 'published' && isArchived(unit)) {
            assertNotArchived(unit, 'Course unit');
          }
          return { success: true as const, data: { unit, idempotent: true } };
        }
        const updated = await tx.courseUnit.update({
          where: { id: unitId },
          data:
            status === 'published'
              ? { status }
              : { status, deletedAt: new Date() },
          select: UNIT_ADMIN_SELECT,
        });
        await this.audit(
          tx,
          actor.id,
          context,
          `course_unit.${status}`,
          'course_unit',
          {
            before: { status: unit.status },
            after: { status: updated.status },
            id: unitId,
          },
        );
        return {
          success: true as const,
          data: { unit: updated, idempotent: false },
        };
      }),
    );
  }

  /** CHECKs of CourseUnit plus the topic-course Level rule. */
  private async assertUnitShape(
    tx: Prisma.TransactionClient,
    kind: CourseRow['kind'],
    shape: Pick<UnitRow, 'gradeNumber' | 'volume' | 'levelId'>,
  ) {
    if (shape.volume !== null && shape.gradeNumber === null) {
      throw new BadRequestException({
        code: 'COURSE_UNIT_VOLUME_REQUIRES_GRADE',
        message: 'A unit volume requires a grade number.',
      });
    }
    if (kind === 'topic' && shape.levelId === null) {
      throw new BadRequestException({
        code: 'COURSE_UNIT_LEVEL_REQUIRED',
        message: 'A unit of a topic course requires a Level.',
      });
    }
    if (shape.levelId !== null) {
      const level = await tx.level.findFirst({
        where: { id: shape.levelId, deletedAt: null },
        select: { id: true },
      });
      if (!level) throw new NotFoundException('Level not found.');
    }
  }

  private async lockCourse(
    tx: Prisma.TransactionClient,
    actorId: number,
    courseId: number,
  ): Promise<CourseRow> {
    await lockActiveCmsActor(tx, actorId);
    const rows = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id" FROM "Course" WHERE "id" = ${courseId} FOR UPDATE
    `;
    if (rows.length !== 1) throw new NotFoundException('Course not found.');
    return tx.course.findUniqueOrThrow({
      where: { id: courseId },
      select: COURSE_ADMIN_SELECT,
    });
  }

  private async lockUnit(
    tx: Prisma.TransactionClient,
    actorId: number,
    unitId: number,
  ): Promise<{ unit: UnitRow; course: CourseRow }> {
    await lockActiveCmsActor(tx, actorId);
    const rows = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id" FROM "CourseUnit" WHERE "id" = ${unitId} FOR UPDATE
    `;
    if (rows.length !== 1) {
      throw new NotFoundException('Course unit not found.');
    }
    const { course, ...unit } = await tx.courseUnit.findUniqueOrThrow({
      where: { id: unitId },
      select: { ...UNIT_ADMIN_SELECT, course: { select: COURSE_ADMIN_SELECT } },
    });
    return { unit, course };
  }

  private audit(
    tx: Prisma.TransactionClient,
    actorId: number,
    context: MutationContext,
    action: string,
    targetType: 'course' | 'course_unit',
    summary: {
      before?: Record<string, unknown>;
      after: { id?: number } & Record<string, unknown>;
      id?: number;
    },
  ) {
    return tx.auditLog.create({
      data: {
        actorId,
        action,
        targetType,
        targetId: String(summary.id ?? summary.after.id),
        correlationId: context.correlationId,
        ...(summary.before ? { beforeSummary: toJson(summary.before) } : {}),
        afterSummary: toJson(summary.after),
      },
      select: { id: true },
    });
  }

  private async executeMutation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      const classification = classifyCmsPersistenceError(error);
      if (classification === 'unique_conflict') {
        throw new ConflictException({
          code: 'CONTENT_UNIQUE_CONFLICT',
          message: 'Content conflicts with an existing code or order.',
        });
      }
      if (classification === 'constraint_conflict') {
        throw new ConflictException({
          code: 'CONTENT_CONSTRAINT_CONFLICT',
          message: 'Content violates a database integrity constraint.',
        });
      }
      if (classification === 'concurrent_retry') {
        throw new ConflictException({
          code: 'CONTENT_CONCURRENT_UPDATE',
          message: 'Concurrent content update detected; retry the request.',
        });
      }
      if (classification === 'timeout' || classification === 'connection') {
        throw new ServiceUnavailableException(
          'Content operation is temporarily unavailable; retry the request.',
        );
      }
      throw new InternalServerErrorException('Content operation failed.');
    }
  }
}

function pageMeta(query: { page: number; limit: number }, total: number) {
  return {
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.ceil(total / query.limit),
  };
}

function isArchived(row: { status: string; deletedAt: Date | null }) {
  return row.deletedAt !== null || row.status === 'archived';
}

function assertNotArchived(
  row: { status: string; deletedAt: Date | null },
  label: string,
) {
  if (isArchived(row)) {
    throw new ConflictException({
      code: 'CONTENT_ARCHIVED',
      message: `Archived ${label} cannot be changed.`,
    });
  }
}

function assertExpectedUpdatedAt(updatedAt: Date, expected: string) {
  if (new Date(expected).getTime() !== updatedAt.getTime()) {
    throw new ConflictException({
      code: 'CONTENT_CONCURRENT_UPDATE',
      message: 'The content changed since it was read; reload and retry.',
    });
  }
}

function statusData(status: 'published' | 'archived') {
  return status === 'published'
    ? { status, publishedAt: new Date() }
    : { status, deletedAt: new Date() };
}

/** Fields of `patch` that are given and differ from `current`. */
function changedFields<C extends object, P extends Partial<C>>(
  current: C,
  patch: P,
): Partial<P> {
  const result: Partial<P> = {};
  for (const key of Object.keys(patch) as Array<keyof P & keyof C>) {
    const value = patch[key];
    if (value !== undefined && value !== current[key]) result[key] = value;
  }
  return result;
}

function pick(row: object, keys: string[]) {
  const source = row as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

function toJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
