import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ContentStatus, MediaType, Prisma, Skill } from '@prisma/client';

import { ApiSuccessResponse } from '../../common/interfaces/api-response.interface';
import { escapeLike } from '../../common/utils/sql-pattern';
import { PrismaService } from '../../prisma/prisma.service';

import {
  assertAdminActor,
  classifyCmsPersistenceError,
  CmsActor,
} from './cms-workflow';
import {
  CmsTransactionCoordinator,
  CmsTransactionOperation,
} from './cms-transaction-coordinator';
import { lockActiveCmsActor } from './cms-actor-lock';
import {
  CMS_MEDIA_SELECT,
  CmsMediaRecord,
  unusableMediaReason,
} from './media-usability';
import { collectTestPublishBlockers } from './test-publish-blockers';
import { AdminTestsQueryDto } from './dto/admin-tests-query.dto';
import {
  AdminTestDetailDto,
  AdminTestDto,
} from './dto/admin-test-response.dto';
import { CreateTestDto } from './dto/create-test.dto';
import { PublishTestDto } from './dto/publish-test.dto';
import {
  ReplaceTestStructureDto,
  TEST_STRUCTURE_LIMITS,
} from './dto/replace-test-structure.dto';
import { UpdateTestDto } from './dto/update-test.dto';

export type TestMutationContext = {
  correlationId: string;
};

const TEST_DETAIL_SELECT = {
  id: true,
  levelId: true,
  title: true,
  instruction: true,
  duration: true,
  passScore: true,
  scoringVersion: true,
  status: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  deletedAt: true,
  level: { select: { id: true, code: true } },
  sections: {
    orderBy: [{ orderIndex: 'asc' as const }],
    select: {
      id: true,
      skill: true,
      title: true,
      instruction: true,
      orderIndex: true,
      groups: {
        orderBy: [{ orderIndex: 'asc' as const }],
        select: {
          id: true,
          title: true,
          instruction: true,
          audioId: true,
          imageId: true,
          orderIndex: true,
          placements: {
            orderBy: [{ orderIndex: 'asc' as const }],
            select: {
              orderIndex: true,
              testQuestion: {
                select: {
                  questionId: true,
                  orderIndex: true,
                  question: {
                    select: {
                      type: true,
                      skill: true,
                      levelId: true,
                      difficulty: true,
                      status: true,
                      content: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.TestSelect;

type TestDetailRecord = Prisma.TestGetPayload<{
  select: typeof TEST_DETAIL_SELECT;
}>;

const TEST_LIST_SELECT = {
  id: true,
  levelId: true,
  title: true,
  instruction: true,
  duration: true,
  passScore: true,
  status: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  level: { select: { id: true, code: true } },
  sections: {
    orderBy: [{ orderIndex: 'asc' as const }],
    select: { id: true, skill: true },
  },
  _count: { select: { questions: true } },
} satisfies Prisma.TestSelect;

type TestListRecord = Prisma.TestGetPayload<{
  select: typeof TEST_LIST_SELECT;
}>;

type TestQuestionIdentity = {
  id: number;
  status: ContentStatus;
  deletedAt: Date | null;
  levelId: number;
  skill: Skill;
};

@Injectable()
export class TestAuthoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionCoordinator: CmsTransactionCoordinator,
  ) {}

  async listTests(
    actor: CmsActor,
    query: AdminTestsQueryDto,
  ): Promise<ApiSuccessResponse<AdminTestDto[]>> {
    assertAdminActor(actor);
    const page = await this.findTestPage(query);
    const tests =
      page.ids.length === 0
        ? []
        : await this.prisma.test.findMany({
            where: { id: { in: page.ids } },
            select: TEST_LIST_SELECT,
          });
    const byId = new Map(tests.map((test) => [test.id, test]));
    const data = page.ids
      .map((id) => byId.get(id))
      .filter((test): test is TestListRecord => Boolean(test))
      .map((test) => this.toAdminTest(test));
    return {
      success: true,
      data,
      meta: {
        page: query.page,
        limit: query.limit,
        total: page.total,
        totalPages: Math.ceil(page.total / query.limit),
      },
    };
  }

  async getTest(
    actor: CmsActor,
    testId: number,
  ): Promise<ApiSuccessResponse<AdminTestDetailDto>> {
    assertAdminActor(actor);
    const test = await this.prisma.test.findUnique({
      where: { id: testId },
      select: TEST_DETAIL_SELECT,
    });
    if (!test) throw new NotFoundException('Test not found.');
    return { success: true, data: this.toTestDetail(test) };
  }

  async createTest(
    actor: CmsActor,
    dto: CreateTestDto,
    context: TestMutationContext,
  ) {
    assertAdminActor(actor);
    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        await lockActiveCmsActor(tx, actor.id);
        await this.assertLevelExists(tx, dto.levelId);
        const created = await tx.test.create({
          data: {
            levelId: dto.levelId,
            title: dto.title,
            instruction: normalizeOptionalText(dto.instruction),
            duration: dto.duration,
            passScore: dto.passScore ?? null,
            status: ContentStatus.draft,
            createdById: actor.id,
            updatedById: actor.id,
          },
          select: { id: true },
        });
        const test = await this.loadTestDetail(tx, created.id);
        await this.writeAudit(tx, actor.id, context, {
          action: 'test.created',
          testId: test.id,
          test,
        });
        return { success: true as const, data: this.toTestDetail(test) };
      }),
    );
  }

  async updateTest(
    actor: CmsActor,
    testId: number,
    dto: UpdateTestDto,
    context: TestMutationContext,
  ) {
    assertAdminActor(actor);
    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        const test = await this.lockTest(tx, 'test.update', testId, actor.id);
        this.assertDraftOnly(test);
        this.assertExpectedUpdatedAt(test, dto.expectedUpdatedAt);
        if (dto.levelId !== undefined) {
          await this.assertLevelExists(tx, dto.levelId);
        }
        const data: Prisma.TestUncheckedUpdateInput = {
          updatedById: actor.id,
        };
        if (dto.levelId !== undefined) data.levelId = dto.levelId;
        if (dto.title !== undefined) data.title = dto.title;
        if (dto.instruction !== undefined) {
          data.instruction = normalizeOptionalText(dto.instruction);
        }
        if (dto.duration !== undefined) data.duration = dto.duration;
        if (dto.passScore !== undefined) data.passScore = dto.passScore;
        await tx.test.update({ where: { id: testId }, data });
        const updated = await this.loadTestDetail(tx, testId);
        await this.writeAudit(tx, actor.id, context, {
          action: 'test.updated',
          testId,
          test: updated,
        });
        return { success: true as const, data: this.toTestDetail(updated) };
      }),
    );
  }

  async replaceTestStructure(
    actor: CmsActor,
    testId: number,
    dto: ReplaceTestStructureDto,
    context: TestMutationContext,
  ) {
    assertAdminActor(actor);
    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        const test = await this.lockTest(
          tx,
          'test.structure_update',
          testId,
          actor.id,
        );
        this.assertDraftOnly(test);
        this.assertExpectedUpdatedAt(test, dto.expectedUpdatedAt);

        const placements = flattenPlacements(dto.sections);
        if (placements.length > TEST_STRUCTURE_LIMITS.maxQuestionsPerTest) {
          throw structureException(
            'sections',
            `A test cannot contain more than ${String(
              TEST_STRUCTURE_LIMITS.maxQuestionsPerTest,
            )} questions.`,
          );
        }
        this.assertNoDuplicateQuestions(placements);
        // H3: take the same Question FOR SHARE locks as publish (ascending id)
        // before reading usability, so an archive cannot interleave between the
        // check and the TestQuestion insert.
        await this.lockQuestions(
          tx,
          uniqueSorted(placements.map((placement) => placement.questionId)),
        );
        await this.assertQuestionsUsable(tx, placements);
        for (let i = 0; i < dto.sections.length; i += 1) {
          const section = dto.sections[i];
          if (!section) continue;
          for (let j = 0; j < section.groups.length; j += 1) {
            const group = section.groups[j];
            if (!group) continue;
            const field = `sections[${String(i)}].groups[${String(j)}]`;
            await this.assertGroupMedia(
              tx,
              group.audioId ?? null,
              MediaType.audio,
              `${field}.audioId`,
            );
            await this.assertGroupMedia(
              tx,
              group.imageId ?? null,
              MediaType.image,
              `${field}.imageId`,
            );
          }
        }
        await this.deleteStructure(tx, testId);
        await this.createStructure(tx, testId, dto);
        await tx.test.update({
          where: { id: testId },
          data: { updatedById: actor.id },
        });
        const updated = await this.loadTestDetail(tx, testId);
        await this.writeAudit(tx, actor.id, context, {
          action: 'test.structure_updated',
          testId,
          test: updated,
        });
        return { success: true as const, data: this.toTestDetail(updated) };
      }),
    );
  }

  async publishTest(
    actor: CmsActor,
    testId: number,
    dto: PublishTestDto,
    context: TestMutationContext,
  ) {
    assertAdminActor(actor);
    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        const test = await this.lockTest(tx, 'test.publish', testId, actor.id);
        this.assertPublishableStatus(test);
        this.assertExpectedUpdatedAt(test, dto.expectedUpdatedAt);

        const questionIds = uniqueSorted(
          test.sections.flatMap((section) =>
            section.groups.flatMap((group) =>
              group.placements.map(
                (placement) => placement.testQuestion.questionId,
              ),
            ),
          ),
        );
        const mediaIds = uniqueSorted(
          test.sections.flatMap((section) =>
            section.groups.flatMap((group) =>
              [group.audioId, group.imageId].filter(
                (mediaId): mediaId is number => mediaId !== null,
              ),
            ),
          ),
        );
        await this.lockQuestions(tx, questionIds);
        // H4: the concurrency harness (and any future extension) observes the
        // production point where every Question lock is already held.
        await this.transactionCoordinator.checkpoint({
          operation: 'test.publish',
          phase: 'after_question_locks',
          entityType: 'test',
          entityId: testId,
          transaction: tx,
        });
        if (mediaIds.length > 0) {
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "Media" WHERE "id" IN (${Prisma.join(
              mediaIds,
            )}) ORDER BY "id" FOR SHARE`,
          );
        }
        // Read the locked rows again so the publish decision uses the state
        // that cannot change until this transaction commits (TL-98).
        const [questions, media, level] = await Promise.all([
          questionIds.length === 0
            ? Promise.resolve([] as TestQuestionIdentity[])
            : tx.question.findMany({
                where: { id: { in: questionIds } },
                select: {
                  id: true,
                  status: true,
                  deletedAt: true,
                  levelId: true,
                  skill: true,
                },
              }),
          mediaIds.length === 0
            ? Promise.resolve([] as CmsMediaRecord[])
            : tx.media.findMany({
                where: { id: { in: mediaIds } },
                select: CMS_MEDIA_SELECT,
              }),
          tx.level.findUnique({
            where: { id: test.levelId },
            select: { id: true },
          }),
        ]);
        const reasons = collectTestPublishBlockers({
          test,
          questions,
          media,
          levelExists: level !== null,
        });
        if (reasons.length > 0) {
          // GlobalExceptionFilter flattens non-framework fields into
          // error.details, so `reasons` is the documented details.reasons.
          throw new ConflictException({
            code: 'TEST_NOT_PUBLISHABLE',
            message: 'Test does not meet the publish requirements.',
            reasons: reasons.slice(0, 20),
          });
        }

        await tx.test.update({
          where: { id: testId },
          data: {
            status: ContentStatus.published,
            publishedAt: new Date(),
            publishedById: actor.id,
            updatedById: actor.id,
          },
        });
        const published = await this.loadTestDetail(tx, testId);
        await this.writeAudit(tx, actor.id, context, {
          action: 'test.published',
          testId,
          test: published,
        });
        return {
          success: true as const,
          data: this.toTestDetail(published),
        };
      }),
    );
  }

  async archiveTest(
    actor: CmsActor,
    testId: number,
    context: TestMutationContext,
  ) {
    assertAdminActor(actor);
    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        const test = await this.lockTest(tx, 'test.archive', testId, actor.id);
        if (isTestArchived(test)) {
          throw new ConflictException({
            code: 'TEST_ARCHIVED',
            message: 'Archived Test cannot be changed.',
          });
        }
        await tx.test.update({
          where: { id: testId },
          data: {
            status: ContentStatus.archived,
            deletedAt: new Date(),
            updatedById: actor.id,
          },
        });
        const archived = await this.loadTestDetail(tx, testId);
        await this.writeAudit(tx, actor.id, context, {
          action: 'test.archived',
          testId,
          test: archived,
        });
        return { success: true as const, data: this.toTestDetail(archived) };
      }),
    );
  }

  async duplicateTest(
    actor: CmsActor,
    testId: number,
    context: TestMutationContext,
  ) {
    assertAdminActor(actor);
    return this.executeMutation(async () =>
      this.prisma.$transaction(async (tx) => {
        const source = await this.lockTest(
          tx,
          'test.duplicate',
          testId,
          actor.id,
        );
        const created = await tx.test.create({
          data: {
            levelId: source.levelId,
            title: duplicateTitle(source.title),
            instruction: source.instruction,
            duration: source.duration,
            passScore: source.passScore,
            scoringVersion: source.scoringVersion,
            status: ContentStatus.draft,
            createdById: actor.id,
            updatedById: actor.id,
          },
          select: { id: true },
        });
        let orderIndex = 0;
        for (const section of source.sections) {
          const newSection = await tx.testSection.create({
            data: {
              testId: created.id,
              skill: section.skill,
              title: section.title,
              instruction: section.instruction,
              orderIndex: section.orderIndex,
            },
            select: { id: true },
          });
          for (const group of section.groups) {
            const newGroup = await tx.questionGroup.create({
              data: {
                testId: created.id,
                sectionId: newSection.id,
                title: group.title,
                instruction: group.instruction,
                audioId: group.audioId,
                imageId: group.imageId,
                orderIndex: group.orderIndex,
              },
              select: { id: true },
            });
            for (const placement of group.placements) {
              orderIndex += 1;
              const testQuestion = await tx.testQuestion.create({
                data: {
                  testId: created.id,
                  questionId: placement.testQuestion.questionId,
                  orderIndex,
                },
                select: { id: true },
              });
              await tx.testQuestionPlacement.create({
                data: {
                  testQuestionId: testQuestion.id,
                  testId: created.id,
                  sectionId: newSection.id,
                  groupId: newGroup.id,
                  orderIndex,
                },
              });
            }
          }
        }
        const duplicate = await this.loadTestDetail(tx, created.id);
        await this.writeAudit(tx, actor.id, context, {
          action: 'test.duplicated',
          testId: duplicate.id,
          test: duplicate,
          sourceTestId: source.id,
        });
        return {
          success: true as const,
          data: this.toTestDetail(duplicate),
        };
      }),
    );
  }

  private async findTestPage(
    query: AdminTestsQueryDto,
  ): Promise<{ ids: number[]; total: number }> {
    const filters: Prisma.Sql[] = [];
    if (query.levelId !== undefined) {
      filters.push(Prisma.sql`t."levelId" = ${query.levelId}`);
    }
    if (query.status !== undefined) {
      filters.push(Prisma.sql`t."status" = ${query.status}::"ContentStatus"`);
    } else {
      // TL-82a applied to tests: archived tests are hidden by default so the
      // admin list only shows work in progress and published tests.
      filters.push(Prisma.sql`t."status" <> 'archived'::"ContentStatus"`);
      filters.push(Prisma.sql`t."deletedAt" IS NULL`);
    }
    if (query.q !== undefined) {
      // ILIKE over Test.title; escapeLike makes `%`/`_` literal.
      const pattern = `%${escapeLike(query.q)}%`;
      filters.push(Prisma.sql`t."title" ILIKE ${pattern}`);
    }
    const whereSql =
      filters.length === 0 ? Prisma.sql`TRUE` : Prisma.join(filters, ' AND ');
    const skip = (query.page - 1) * query.limit;
    const [rows, counts] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        SELECT t."id" FROM "Test" t
        WHERE ${whereSql}
        ORDER BY t."updatedAt" DESC, t."id" DESC
        LIMIT ${query.limit} OFFSET ${skip}
      `),
      this.prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
        SELECT count(*)::int AS total FROM "Test" t
        WHERE ${whereSql}
      `),
    ]);
    return {
      ids: rows.map((row) => row.id),
      total: counts[0]?.total ?? 0,
    };
  }

  /**
   * TL-97: every mutation runs `lockActiveCmsActor` first, then locks the Test
   * row with `FOR UPDATE` and reads it again. The two checkpoints let the
   * concurrency harness observe the real production lock boundary.
   */
  private async lockTest(
    tx: Prisma.TransactionClient,
    operation: CmsTransactionOperation,
    testId: number,
    actorId: number,
  ): Promise<TestDetailRecord> {
    const identity = await tx.test.findUnique({
      where: { id: testId },
      select: { id: true },
    });
    if (!identity) throw new NotFoundException('Test not found.');
    await this.transactionCoordinator.checkpoint({
      operation,
      phase: 'before_lock',
      entityType: 'test',
      entityId: testId,
      transaction: tx,
    });
    await lockActiveCmsActor(tx, actorId);
    const rows = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id" FROM "Test" WHERE "id" = ${testId} FOR UPDATE
    `;
    if (rows.length !== 1) {
      throw new NotFoundException('Test not found.');
    }
    await this.transactionCoordinator.checkpoint({
      operation,
      phase: 'after_lock',
      entityType: 'test',
      entityId: testId,
      transaction: tx,
    });
    return this.loadTestDetail(tx, testId);
  }

  private loadTestDetail(
    tx: Prisma.TransactionClient,
    testId: number,
  ): Promise<TestDetailRecord> {
    return tx.test.findUniqueOrThrow({
      where: { id: testId },
      select: TEST_DETAIL_SELECT,
    });
  }

  private async assertLevelExists(
    tx: Prisma.TransactionClient,
    levelId: number,
  ): Promise<void> {
    const level = await tx.level.findUnique({
      where: { id: levelId },
      select: { id: true },
    });
    if (!level) {
      // TL-100: same shape as the M4.1a authoring validation error so clients
      // can map `details.path` onto the form field.
      throw new UnprocessableEntityException({
        code: 'level_not_found',
        path: 'levelId',
        message: 'Test level does not exist.',
      });
    }
  }

  /** TL-97: a published test is read-only and an archived one is terminal. */
  private assertDraftOnly(test: TestDetailRecord): void {
    if (isTestArchived(test)) {
      throw new ConflictException({
        code: 'TEST_ARCHIVED',
        message: 'Archived Test cannot be changed.',
      });
    }
    if (test.status !== ContentStatus.draft) {
      throw new ConflictException({
        code: 'TEST_NOT_EDITABLE',
        message: 'Only a draft Test can be changed.',
      });
    }
  }

  /** TL-97: publishing is allowed only from draft; archived is terminal. */
  private assertPublishableStatus(test: TestDetailRecord): void {
    if (isTestArchived(test)) {
      throw new ConflictException({
        code: 'TEST_ARCHIVED',
        message: 'Archived Test cannot be published.',
      });
    }
    if (test.status !== ContentStatus.draft) {
      throw new ConflictException({
        code: 'TEST_NOT_EDITABLE',
        message: 'Only a draft Test can be published.',
      });
    }
  }

  private assertExpectedUpdatedAt(
    test: TestDetailRecord,
    expectedUpdatedAt: string,
  ): void {
    const expected = new Date(expectedUpdatedAt).getTime();
    if (!Number.isFinite(expected) || expected !== test.updatedAt.getTime()) {
      throw new ConflictException({
        code: 'TEST_CONCURRENT_UPDATE',
        message: 'The Test changed since it was read; reload and retry.',
      });
    }
  }

  /**
   * TL-96: the same question may appear only once in a test. The 422 carries
   * the path of the repeated occurrence so the builder can focus it.
   */
  private assertNoDuplicateQuestions(
    placements: Array<{ field: string; questionId: number }>,
  ): number[] {
    const seen = new Map<number, string>();
    const unique: number[] = [];
    for (const placement of placements) {
      const previous = seen.get(placement.questionId);
      if (previous !== undefined) {
        throw structureException(
          placement.field,
          `Question ${String(
            placement.questionId,
          )} is already used at ${previous}.`,
        );
      }
      seen.set(placement.questionId, placement.field);
      unique.push(placement.questionId);
    }
    return unique;
  }

  /**
   * TL-97/H3: mutations that bind questions take `FOR SHARE` row locks on the
   * referenced questions in ascending id order, matching publish, so archival
   * and publish serialize against the same rows in the same order.
   */
  private async lockQuestions(
    tx: Prisma.TransactionClient,
    questionIds: number[],
  ): Promise<void> {
    if (questionIds.length === 0) return;
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Question" WHERE "id" IN (${Prisma.join(
        questionIds,
      )}) ORDER BY "id" FOR SHARE`,
    );
  }

  private async assertQuestionsUsable(
    tx: Prisma.TransactionClient,
    placements: Array<{ field: string; questionId: number }>,
  ): Promise<void> {
    if (placements.length === 0) return;
    const questions = await tx.question.findMany({
      where: {
        id: { in: uniqueSorted(placements.map((item) => item.questionId)) },
      },
      select: { id: true, status: true, deletedAt: true },
    });
    const byId = new Map(questions.map((question) => [question.id, question]));
    for (const placement of placements) {
      const question = byId.get(placement.questionId);
      let reason: 'not_found' | 'archived' | null = null;
      if (!question) {
        reason = 'not_found';
      } else if (
        question.deletedAt !== null ||
        question.status === ContentStatus.archived
      ) {
        reason = 'archived';
      }
      if (reason !== null) {
        throw new ConflictException({
          code: 'TEST_QUESTION_NOT_USABLE',
          message:
            'Test questions must exist and must not be soft-deleted or archived.',
          field: placement.field,
          reason,
        });
      }
    }
  }

  /**
   * TL-81a save-level media rule: a pending/processing file may be referenced
   * while the question or group is being prepared; publish re-checks readiness.
   */
  private async assertGroupMedia(
    tx: Prisma.TransactionClient,
    mediaId: number | null,
    expectedType: MediaType,
    field: string,
  ): Promise<void> {
    if (mediaId === null) return;
    const rows = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id" FROM "Media" WHERE "id" = ${mediaId} FOR SHARE
    `;
    const media =
      rows.length === 1
        ? await tx.media.findUnique({
            where: { id: mediaId },
            select: CMS_MEDIA_SELECT,
          })
        : null;
    const reason = unusableMediaReason(media, expectedType);
    if (reason !== null) {
      throw new ConflictException({
        code: 'MEDIA_NOT_USABLE',
        message: 'Test group media must exist, be live and of the right type.',
        field,
        reason,
      });
    }
  }

  private async deleteStructure(
    tx: Prisma.TransactionClient,
    testId: number,
  ): Promise<void> {
    // Placement and TestQuestion rows reference the tree with Restrict, so the
    // leaves are removed before their parents (TL-96 full replacement).
    await tx.testQuestionPlacement.deleteMany({ where: { testId } });
    await tx.testQuestion.deleteMany({ where: { testId } });
    await tx.questionGroup.deleteMany({ where: { testId } });
    await tx.testSection.deleteMany({ where: { testId } });
  }

  private async createStructure(
    tx: Prisma.TransactionClient,
    testId: number,
    dto: ReplaceTestStructureDto,
  ): Promise<void> {
    let orderIndex = 0;
    for (let i = 0; i < dto.sections.length; i += 1) {
      const section = dto.sections[i];
      if (!section) continue;
      const created = await tx.testSection.create({
        data: {
          testId,
          skill: section.skill,
          title: section.title,
          instruction: normalizeOptionalText(section.instruction),
          orderIndex: i + 1,
        },
        select: { id: true },
      });
      for (let j = 0; j < section.groups.length; j += 1) {
        const group = section.groups[j];
        if (!group) continue;
        const createdGroup = await tx.questionGroup.create({
          data: {
            testId,
            sectionId: created.id,
            title: normalizeOptionalText(group.title),
            instruction: normalizeOptionalText(group.instruction),
            audioId: group.audioId ?? null,
            imageId: group.imageId ?? null,
            orderIndex: j + 1,
          },
          select: { id: true },
        });
        for (const questionId of group.questionIds) {
          orderIndex += 1;
          const testQuestion = await tx.testQuestion.create({
            data: { testId, questionId, orderIndex },
            select: { id: true },
          });
          // TL-96: TestQuestion.orderIndex equals the placement order index and
          // is the continuous 1..N order across the whole test.
          await tx.testQuestionPlacement.create({
            data: {
              testQuestionId: testQuestion.id,
              testId,
              sectionId: created.id,
              groupId: createdGroup.id,
              orderIndex,
            },
          });
        }
      }
    }
  }

  private toAdminTest(test: TestListRecord): AdminTestDto {
    const sectionCount = test.sections.length;
    return {
      id: test.id,
      levelId: test.levelId,
      levelCode: test.level.code,
      title: test.title,
      instruction: test.instruction,
      duration: test.duration,
      passScore: test.passScore,
      maxScore: 100 * sectionCount,
      status: test.status,
      version: test.version,
      sectionCount,
      questionCount: test._count.questions,
      skills: distinctSkills(test.sections.map((section) => section.skill)),
      createdAt: test.createdAt,
      updatedAt: test.updatedAt,
      publishedAt: test.publishedAt,
    };
  }

  private toTestDetail(test: TestDetailRecord): AdminTestDetailDto {
    const sections = test.sections.map((section) => {
      const groups = section.groups.map((group) => ({
        id: group.id,
        title: group.title,
        instruction: group.instruction,
        audioId: group.audioId,
        imageId: group.imageId,
        orderIndex: group.orderIndex,
        questions: group.placements.map((placement) => ({
          questionId: placement.testQuestion.questionId,
          orderIndex: placement.testQuestion.orderIndex,
          type: placement.testQuestion.question.type,
          skill: placement.testQuestion.question.skill,
          levelId: placement.testQuestion.question.levelId,
          difficulty: placement.testQuestion.question.difficulty,
          status: placement.testQuestion.question.status,
          content: placement.testQuestion.question.content,
        })),
      }));
      return {
        id: section.id,
        skill: section.skill,
        title: section.title,
        instruction: section.instruction,
        orderIndex: section.orderIndex,
        questionCount: groups.reduce(
          (total, group) => total + group.questions.length,
          0,
        ),
        groups,
      };
    });
    const sectionCount = sections.length;
    return {
      id: test.id,
      levelId: test.levelId,
      levelCode: test.level.code,
      title: test.title,
      instruction: test.instruction,
      duration: test.duration,
      passScore: test.passScore,
      maxScore: 100 * sectionCount,
      status: test.status,
      version: test.version,
      sectionCount,
      questionCount: sections.reduce(
        (total, section) => total + section.questionCount,
        0,
      ),
      skills: distinctSkills(sections.map((section) => section.skill)),
      createdAt: test.createdAt,
      updatedAt: test.updatedAt,
      publishedAt: test.publishedAt,
      sections,
    };
  }

  private writeAudit(
    tx: Prisma.TransactionClient,
    actorId: number,
    context: TestMutationContext,
    input: {
      action: string;
      testId: number;
      test: TestDetailRecord;
      sourceTestId?: number;
    },
  ) {
    return tx.auditLog.create({
      data: {
        actorId,
        action: input.action,
        targetType: 'test',
        targetId: String(input.testId),
        correlationId: context.correlationId,
        afterSummary: {
          entityType: 'test',
          entityId: input.testId,
          status: input.test.status,
          sectionCount: input.test.sections.length,
          questionCount: input.test.sections.reduce(
            (total, section) =>
              total +
              section.groups.reduce(
                (groupTotal, group) => groupTotal + group.placements.length,
                0,
              ),
            0,
          ),
          ...(input.sourceTestId === undefined
            ? {}
            : { sourceTestId: input.sourceTestId }),
        },
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
          code: 'TEST_UNIQUE_CONFLICT',
          message: 'Test content conflicts.',
        });
      }
      if (classification === 'constraint_conflict') {
        throw new ConflictException({
          code: 'TEST_CONSTRAINT_CONFLICT',
          message: 'Test violates a database integrity constraint.',
        });
      }
      if (classification === 'concurrent_retry') {
        throw new ConflictException({
          code: 'TEST_CONCURRENT_UPDATE',
          message: 'Concurrent Test update detected; retry the request.',
        });
      }
      if (classification === 'timeout' || classification === 'connection') {
        throw new ServiceUnavailableException(
          'Test operation is temporarily unavailable; retry the request.',
        );
      }
      throw new InternalServerErrorException('Test operation failed.');
    }
  }
}

function isTestArchived(test: {
  status: ContentStatus;
  deletedAt: Date | null;
}): boolean {
  return test.status === ContentStatus.archived || test.deletedAt !== null;
}

function normalizeOptionalText(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function duplicateTitle(title: string): string {
  const suffix = ' (bản sao)';
  // H6: truncate by code point so a surrogate pair (emoji) is never split into
  // a lone surrogate that the database would reject.
  const budget = 200 - Array.from(suffix).length;
  return `${Array.from(title).slice(0, budget).join('')}${suffix}`;
}

/** Flattened placement list in section → group → question order (TL-96). */
function flattenPlacements(
  sections: ReplaceTestStructureDto['sections'],
): Array<{ field: string; questionId: number }> {
  const placements: Array<{ field: string; questionId: number }> = [];
  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i];
    if (!section) continue;
    for (let j = 0; j < section.groups.length; j += 1) {
      const group = section.groups[j];
      if (!group) continue;
      for (let k = 0; k < group.questionIds.length; k += 1) {
        const questionId = group.questionIds[k];
        if (questionId === undefined) continue;
        placements.push({
          field: `sections[${String(i)}].groups[${String(j)}].questionIds[${String(k)}]`,
          questionId,
        });
      }
    }
  }
  return placements;
}

function structureException(
  path: string,
  message: string,
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'TEST_STRUCTURE_INVALID',
    path,
    message,
  });
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function distinctSkills(skills: Skill[]): Skill[] {
  const result: Skill[] = [];
  for (const skill of skills) {
    if (!result.includes(skill)) result.push(skill);
  }
  return result;
}
