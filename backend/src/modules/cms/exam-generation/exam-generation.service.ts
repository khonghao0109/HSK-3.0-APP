import { randomBytes } from 'node:crypto';

import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ContentStatus } from '@prisma/client';

import { ApiSuccessResponse } from '../../../common/interfaces/api-response.interface';
import { PrismaService } from '../../../prisma/prisma.service';
import { assertAdminActor, CmsActor } from '../cms-workflow';
import { GenerateTestDto, GeneratedTestDto } from '../dto/generate-test.dto';
import {
  TestAuthoringService,
  TestMutationContext,
} from '../test-authoring.service';

import { planExam, PoolQuestion, PoolSet } from './exam-plan';

/** Q357: sinh đề draft từ `ExamBlueprint` (`POST /admin/cms/tests/generate`). */
@Injectable()
export class ExamGenerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tests: TestAuthoringService,
  ) {}

  async generate(
    actor: CmsActor,
    dto: GenerateTestDto,
    context: TestMutationContext,
  ): Promise<ApiSuccessResponse<GeneratedTestDto>> {
    assertAdminActor(actor);
    const blueprint = await this.prisma.examBlueprint.findUnique({
      where: { code: dto.blueprintCode },
      include: {
        sections: {
          orderBy: { orderIndex: 'asc' },
          include: { parts: { orderBy: { orderIndex: 'asc' } } },
        },
      },
    });
    if (!blueprint) {
      throw new NotFoundException({
        code: 'BLUEPRINT_NOT_FOUND',
        message: 'Exam blueprint not found.',
      });
    }
    if (blueprint.status === ContentStatus.archived) {
      throw new ConflictException({
        code: 'BLUEPRINT_ARCHIVED',
        message: 'Exam blueprint is archived.',
      });
    }
    const statuses = dto.includeDraft
      ? [ContentStatus.published, ContentStatus.draft]
      : [ContentStatus.published];

    const rows = await this.prisma.question.findMany({
      where: {
        levelId: blueprint.levelId,
        deletedAt: null,
        status: { in: statuses },
      },
      select: {
        id: true,
        type: true,
        skill: true,
        difficulty: true,
        tags: { select: { tag: { select: { slug: true } } } },
        setItem: { select: { setId: true } },
        targetWords: { select: { wordId: true } },
      },
      orderBy: { id: 'asc' },
    });
    const usage = await this.prisma.testQuestion.groupBy({
      by: ['questionId'],
      where: {
        questionId: { in: rows.map((row) => row.id) },
        test: { deletedAt: null, status: { not: ContentStatus.archived } },
      },
      _count: { _all: true },
    });
    const usageById = new Map(
      usage.map((row) => [row.questionId, row._count._all]),
    );
    const questions: PoolQuestion[] = rows.map((row) => ({
      id: row.id,
      type: row.type,
      skill: row.skill,
      difficulty: row.difficulty,
      tags: row.tags.map((link) => link.tag.slug),
      setId: row.setItem?.setId ?? null,
      targetWordIds: row.targetWords.map((link) => link.wordId),
      usage: usageById.get(row.id) ?? 0,
    }));

    const setRows = await this.prisma.questionSet.findMany({
      where: { levelId: blueprint.levelId, status: { in: statuses } },
      select: {
        id: true,
        skill: true,
        format: true,
        imageId: true,
        audioId: true,
        items: {
          orderBy: { orderIndex: 'asc' },
          select: { questionId: true },
        },
      },
      orderBy: { id: 'asc' },
    });
    const sets: PoolSet[] = setRows.map((set) => ({
      id: set.id,
      skill: set.skill,
      format: set.format,
      imageId: set.imageId,
      audioId: set.audioId,
      questionIds: set.items.map((item) => item.questionId),
    }));

    const excluded = new Set<number>();
    if (dto.excludeTestIds?.length) {
      const links = await this.prisma.testQuestion.findMany({
        where: { testId: { in: dto.excludeTestIds } },
        select: { questionId: true },
      });
      for (const link of links) excluded.add(link.questionId);
    }

    const seed = dto.seed ?? randomBytes(6).toString('hex');
    const plan = planExam(
      blueprint.sections.map((section) => ({
        skill: section.skill,
        title: section.title,
        instruction: section.instruction,
        parts: section.parts.map((part) => ({
          key: part.key,
          title: part.title,
          instruction: part.instruction,
          questionType: part.questionType,
          format: part.format,
          questionCount: part.questionCount,
          fromSet: part.fromSet,
        })),
      })),
      questions,
      sets,
      { seed, excludeQuestionIds: excluded },
    );
    if (!plan.ok) {
      throw new UnprocessableEntityException({
        code: 'BLUEPRINT_POOL_INSUFFICIENT',
        message: `Not enough ${plan.fromSet ? 'question sets' : 'questions'} for part ${plan.partKey}.`,
        part: plan.partKey,
        needed: plan.needed,
        available: plan.available,
        fromSet: plan.fromSet,
      });
    }

    const test = await this.tests.createGeneratedTest(
      actor,
      {
        levelId: blueprint.levelId,
        title: dto.title ?? `${blueprint.title} · ${seed}`,
        instruction: blueprint.instruction,
        duration: blueprint.durationMinutes,
        passScore: blueprint.passScore,
        blueprintId: blueprint.id,
        generationSeed: seed,
        sections: plan.sections.map((section) => ({
          skill: section.skill,
          title: section.title,
          instruction: section.instruction ?? undefined,
          groups: section.groups.map((group) => ({
            title: group.title,
            instruction: group.instruction ?? undefined,
            audioId: group.audioId,
            imageId: group.imageId,
            questionIds: group.questionIds,
          })),
        })),
      },
      context,
    );
    return {
      success: true,
      data: {
        blueprintCode: blueprint.code,
        seed,
        parts: plan.sections.flatMap((section) =>
          section.groups.map((group) => ({
            key: group.partKey,
            setId: group.setId,
            questionIds: group.questionIds,
          })),
        ),
        test,
      },
    };
  }
}
