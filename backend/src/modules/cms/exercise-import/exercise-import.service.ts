import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { sha256CanonicalJson } from '../../../common/utils/canonical-json';
import { PrismaService } from '../../../prisma/prisma.service';
import { lockActiveCmsActor } from '../cms-actor-lock';
import { CmsActor, assertAdminActor } from '../cms-workflow';
import { CmsTransactionCoordinator } from '../cms-transaction-coordinator';
import {
  CommitExerciseImportDto,
  PreviewExerciseImportDto,
} from '../dto/exercise-import.dto';
import {
  EXERCISE_ADMIN_SELECT,
  ExerciseMutationContext,
  ExerciseSnapshot,
} from '../exercise-authoring.service';

import {
  EXERCISE_IMPORT_V1_TRANSACTION_MAX_WAIT_MS,
  EXERCISE_IMPORT_V1_TRANSACTION_TIMEOUT_MS,
} from './exercise-import.constants';
import {
  ExerciseImportError,
  NormalizedExerciseImportRow,
  classifyExerciseImportPersistenceError,
  createExerciseImportPreviewHash,
  validateExerciseImportRows,
} from './lesson-exercise-import';

type PreparedImport = {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: ExerciseImportError[];
  normalizedRows: NormalizedExerciseImportRow[];
};

const IMPORT_JOB_SELECT = {
  id: true,
  dataSourceId: true,
  createdById: true,
  entityType: true,
  status: true,
  idempotencyKey: true,
  fileName: true,
  fileChecksum: true,
  totalRows: true,
  validRows: true,
  errorRows: true,
  importedRows: true,
  summary: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ImportJobSelect;

@Injectable()
export class ExerciseImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionCoordinator: CmsTransactionCoordinator,
  ) {}

  async preview(actor: CmsActor, dto: PreviewExerciseImportDto) {
    assertAdminActor(actor);
    const previewHash = createExerciseImportPreviewHash(dto);
    const prepared = await this.prisma.$transaction((tx) =>
      this.prepareImport(tx, dto),
    );
    return {
      success: true as const,
      data: {
        totalRows: prepared.totalRows,
        validRows: prepared.validRows,
        invalidRows: prepared.invalidRows,
        errors: prepared.errors.map(publicImportError),
        previewHash,
      },
    };
  }

  async commit(
    actor: CmsActor,
    dto: CommitExerciseImportDto,
    rawIdempotencyKey: string | undefined,
    context: ExerciseMutationContext,
  ) {
    assertAdminActor(actor);
    const idempotencyKey = parseImportIdempotencyKey(rawIdempotencyKey);
    const expectedHash = createExerciseImportPreviewHash(dto);
    if (dto.previewHash !== expectedHash) {
      throw new ConflictException(
        'Preview hash does not match; the import payload changed.',
      );
    }

    return this.executeMutation(async () =>
      this.prisma.$transaction(
        async (tx) => {
          await this.transactionCoordinator.checkpoint({
            operation: 'exercise_import.commit',
            phase: 'before_lock',
            entityType: 'exercise_import',
            entityId: dto.dataSourceId,
            transaction: tx,
          });
          await lockActiveCmsActor(tx, actor.id);
          const sourceRows = await tx.$queryRaw<Array<{ id: number }>>`
          SELECT "id" FROM "DataSource"
          WHERE "id" = ${dto.dataSourceId}
          FOR UPDATE
        `;
          if (sourceRows.length !== 1) {
            throw new NotFoundException('Data source not found.');
          }
          const existing = await tx.importJob.findUnique({
            where: { idempotencyKey },
            select: IMPORT_JOB_SELECT,
          });
          if (existing) {
            await this.transactionCoordinator.checkpoint({
              operation: 'exercise_import.commit',
              phase: 'after_lock',
              entityType: 'exercise_import',
              entityId: dto.dataSourceId,
              transaction: tx,
            });
            if (
              existing.createdById !== actor.id ||
              existing.dataSourceId !== dto.dataSourceId ||
              existing.fileName !== dto.fileName ||
              existing.fileChecksum !== expectedHash ||
              existing.entityType !== 'lesson_exercise'
            ) {
              throw new ConflictException(
                'Idempotency-Key was already used for a different import request.',
              );
            }
            const replayValidation = validateExerciseImportRows(dto.rows);
            const expectedSourceKeys = replayValidation.normalizedRows.map(
              (row) => row.sourceKey,
            );
            const sourceKeys = extractSummarySourceKeys(existing.summary);
            if (
              replayValidation.invalidRows !== 0 ||
              existing.status !== 'completed' ||
              existing.startedAt === null ||
              existing.completedAt === null ||
              existing.totalRows !== dto.rows.length ||
              existing.validRows !== dto.rows.length ||
              existing.errorRows !== 0 ||
              existing.importedRows !== dto.rows.length ||
              sourceKeys.length !== expectedSourceKeys.length ||
              sourceKeys.some(
                (sourceKey, index) => sourceKey !== expectedSourceKeys[index],
              )
            ) {
              throw new ConflictException(
                'Existing import job is incomplete; manual review is required.',
              );
            }
            const exercises = await this.findExercisesBySourceKeys(
              tx,
              dto.dataSourceId,
              sourceKeys,
            );
            const exerciseIds = exercises.map((exercise) => exercise.id);
            const [revisionCount, auditCount] = await Promise.all([
              tx.contentRevision.count({
                where: {
                  entityType: 'lesson_exercise',
                  entityId: { in: exerciseIds },
                  revision: 1,
                },
              }),
              tx.auditLog.count({
                where: {
                  action: 'lesson_exercise.import_completed',
                  targetType: 'exercise_import_job',
                  targetId: String(existing.id),
                },
              }),
            ]);
            if (
              exercises.length !== sourceKeys.length ||
              revisionCount !== exercises.length ||
              auditCount !== 1
            ) {
              throw new ConflictException(
                'Existing import job is incomplete; manual review is required.',
              );
            }
            return {
              success: true as const,
              data: {
                importJob: existing,
                exercises,
                importedRows: existing.importedRows,
                idempotent: true,
              },
            };
          }

          const structural = validateExerciseImportRows(dto.rows);
          await this.lockImportParentHierarchy(tx, structural.normalizedRows);
          await this.transactionCoordinator.checkpoint({
            operation: 'exercise_import.commit',
            phase: 'after_lock',
            entityType: 'exercise_import',
            entityId: dto.dataSourceId,
            transaction: tx,
          });
          const prepared = await this.prepareImport(tx, dto);
          if (prepared.invalidRows > 0) {
            throw new UnprocessableEntityException({
              code: 'IMPORT_VALIDATION_FAILED',
              message: 'Exercise import contains invalid rows.',
              errors: prepared.errors.map(publicImportError),
            });
          }

          const startedAt = new Date();
          const importJob = await tx.importJob.create({
            data: {
              dataSourceId: dto.dataSourceId,
              createdById: actor.id,
              entityType: 'lesson_exercise',
              status: 'completed',
              idempotencyKey,
              fileName: dto.fileName,
              fileChecksum: expectedHash,
              totalRows: prepared.totalRows,
              validRows: prepared.validRows,
              errorRows: 0,
              importedRows: prepared.validRows,
              summary: {
                contractVersion: 'lesson-exercise-import-v1',
                atomicity: 'all_or_nothing',
                duplicatePolicy: 'reject',
                sourceKeys: prepared.normalizedRows.map((row) => row.sourceKey),
              },
              startedAt,
              completedAt: new Date(),
            },
            select: IMPORT_JOB_SELECT,
          });

          const exercises = [];
          for (const row of prepared.normalizedRows) {
            const snapshot = snapshotFromImportRow(row);
            const exercise = await tx.lessonExercise.create({
              data: {
                lessonId: row.value.lessonId,
                topicId: row.value.topicId,
                type: snapshot.type,
                prompt: snapshot.prompt,
                content: snapshot.content as Prisma.InputJsonValue,
                answer: snapshot.answer as Prisma.InputJsonValue,
                explanation: snapshot.explanation,
                orderIndex: snapshot.orderIndex,
                mediaId: snapshot.mediaId,
                version: 1,
                status: 'draft',
                dataSourceId: dto.dataSourceId,
                sourceKey: row.sourceKey,
                createdById: actor.id,
                updatedById: actor.id,
              },
              select: EXERCISE_ADMIN_SELECT,
            });
            await tx.contentRevision.create({
              data: {
                entityType: 'lesson_exercise',
                entityId: exercise.id,
                revision: 1,
                snapshot: snapshot as Prisma.InputJsonValue,
                contentHash: sha256CanonicalJson(snapshot),
                authorId: actor.id,
              },
              select: { id: true },
            });
            exercises.push(exercise);
          }

          await tx.auditLog.create({
            data: {
              actorId: actor.id,
              action: 'lesson_exercise.import_completed',
              targetType: 'exercise_import_job',
              targetId: String(importJob.id),
              correlationId: context.correlationId,
              afterSummary: {
                entityType: 'lesson_exercise',
                importJobId: importJob.id,
                dataSourceId: dto.dataSourceId,
                importedRows: exercises.length,
                fileChecksum: expectedHash,
              },
            },
            select: { id: true },
          });

          return {
            success: true as const,
            data: {
              importJob,
              exercises,
              importedRows: exercises.length,
              idempotent: false,
            },
          };
        },
        {
          maxWait: EXERCISE_IMPORT_V1_TRANSACTION_MAX_WAIT_MS,
          timeout: EXERCISE_IMPORT_V1_TRANSACTION_TIMEOUT_MS,
        },
      ),
    );
  }

  private async prepareImport(
    tx: Prisma.TransactionClient,
    dto: PreviewExerciseImportDto,
  ): Promise<PreparedImport> {
    const dataSource = await tx.dataSource.findUnique({
      where: { id: dto.dataSourceId },
      select: { id: true },
    });
    if (!dataSource) throw new NotFoundException('Data source not found.');

    const structural = validateExerciseImportRows(dto.rows);
    const candidates = structural.normalizedRows;
    if (candidates.length === 0) {
      return structural;
    }

    const lessonIds = [...new Set(candidates.map((row) => row.value.lessonId))];
    const topicIds = [
      ...new Set(
        candidates
          .map((row) => row.value.topicId)
          .filter((id): id is number => id !== null),
      ),
    ];
    const mediaIds = [
      ...new Set(
        candidates
          .map((row) => row.value.mediaId)
          .filter((id): id is number => typeof id === 'number'),
      ),
    ];
    const [lessons, topics, media, existingKeys] = await Promise.all([
      tx.lesson.findMany({
        where: { id: { in: lessonIds }, deletedAt: null },
        select: { id: true },
      }),
      tx.topic.findMany({
        where: { id: { in: topicIds }, deletedAt: null },
        select: { id: true, lessonId: true },
      }),
      tx.media.findMany({
        where: { id: { in: mediaIds } },
        select: { id: true },
      }),
      tx.lessonExercise.findMany({
        where: {
          dataSourceId: dto.dataSourceId,
          sourceKey: { in: candidates.map((row) => row.sourceKey) },
        },
        select: { sourceKey: true },
      }),
    ]);
    const liveLessons = new Set(lessons.map((lesson) => lesson.id));
    const liveTopics = new Map(
      topics.map((topic) => [topic.id, topic.lessonId] as const),
    );
    const knownMedia = new Set(media.map((item) => item.id));
    const existing = new Set(
      existingKeys
        .map((item) => item.sourceKey)
        .filter((key): key is string => key !== null),
    );

    const relationalErrors: ExerciseImportError[] = [];
    for (const row of candidates) {
      if (existing.has(row.sourceKey)) {
        relationalErrors.push({
          rowNumber: row.rowNumber,
          code: 'source_key_already_exists',
          path: 'sourceKey',
        });
      }
      if (!liveLessons.has(row.value.lessonId)) {
        relationalErrors.push({
          rowNumber: row.rowNumber,
          code: 'parent_lesson_not_found',
          path: 'lessonId',
        });
      }
      if (
        row.value.topicId !== null &&
        liveTopics.get(row.value.topicId) !== row.value.lessonId
      ) {
        relationalErrors.push({
          rowNumber: row.rowNumber,
          code: 'topic_lesson_mismatch',
          path: 'topicId',
        });
      }
      if (
        typeof row.value.mediaId === 'number' &&
        !knownMedia.has(row.value.mediaId)
      ) {
        relationalErrors.push({
          rowNumber: row.rowNumber,
          code: 'media_not_found',
          path: 'mediaId',
        });
      }
    }
    const errors = [...structural.errors, ...relationalErrors].sort(
      compareImportErrors,
    );
    const invalidRowNumbers = new Set(errors.map((error) => error.rowNumber));
    const normalizedRows = candidates.filter(
      (row) => !invalidRowNumbers.has(row.rowNumber),
    );
    return {
      totalRows: structural.totalRows,
      validRows: normalizedRows.length,
      invalidRows: structural.totalRows - normalizedRows.length,
      errors,
      normalizedRows,
    };
  }

  private async findExercisesBySourceKeys(
    tx: Prisma.TransactionClient,
    dataSourceId: number,
    sourceKeys: string[],
  ) {
    const exercises = await tx.lessonExercise.findMany({
      where: { dataSourceId, sourceKey: { in: sourceKeys } },
      select: EXERCISE_ADMIN_SELECT,
    });
    const byKey = new Map(
      exercises.map((exercise) => [exercise.sourceKey, exercise] as const),
    );
    const ordered = sourceKeys
      .map((key) => byKey.get(key))
      .filter((exercise): exercise is (typeof exercises)[number] =>
        Boolean(exercise),
      );
    if (ordered.length !== sourceKeys.length) {
      throw new ConflictException(
        'Committed import provenance is incomplete; manual review is required.',
      );
    }
    return ordered;
  }

  private async lockImportParentHierarchy(
    tx: Prisma.TransactionClient,
    rows: NormalizedExerciseImportRow[],
  ): Promise<void> {
    const lessonIds = [...new Set(rows.map((row) => row.value.lessonId))].sort(
      (left, right) => left - right,
    );
    if (lessonIds.length > 0) {
      await tx.$queryRaw(
        Prisma.sql`
          SELECT id
          FROM "Lesson"
          WHERE id IN (${Prisma.join(lessonIds)})
          ORDER BY id
          FOR UPDATE
        `,
      );
    }

    const topicIds = [
      ...new Set(
        rows
          .map((row) => row.value.topicId)
          .filter((id): id is number => id !== null),
      ),
    ].sort((left, right) => left - right);
    if (topicIds.length > 0) {
      await tx.$queryRaw(
        Prisma.sql`
          SELECT id
          FROM "Topic"
          WHERE id IN (${Prisma.join(topicIds)})
          ORDER BY id
          FOR UPDATE
        `,
      );
    }
  }

  private async executeMutation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      const classification = classifyExerciseImportPersistenceError(error);
      if (
        classification === 'idempotency_conflict' ||
        classification === 'duplicate_source_key' ||
        classification === 'constraint'
      ) {
        throw new ConflictException(
          'Exercise import conflicts with existing persisted data.',
        );
      }
      if (classification === 'retryable_conflict') {
        throw new ConflictException(
          'Concurrent exercise import detected; retry the request.',
        );
      }
      if (classification === 'timeout' || classification === 'connection') {
        throw new ServiceUnavailableException(
          'Exercise import is temporarily unavailable; retry the request.',
        );
      }
      throw new InternalServerErrorException('Exercise import failed.');
    }
  }
}

function snapshotFromImportRow(
  row: NormalizedExerciseImportRow,
): ExerciseSnapshot {
  return {
    type: row.value.type,
    prompt: row.value.prompt,
    content: row.value.content,
    answer: row.value.answer,
    explanation: row.value.explanation ?? null,
    mediaId: row.value.mediaId ?? null,
    orderIndex: row.value.orderIndex,
  };
}

function publicImportError(error: ExerciseImportError) {
  return {
    rowNumber: error.rowNumber,
    code: PUBLIC_ERROR_CODES[error.code] ?? error.code.toUpperCase(),
    path: error.path,
  };
}

const PUBLIC_ERROR_CODES: Record<string, string> = {
  unknown_field: 'UNEXPECTED_FIELD',
  authoritative_option_not_found: 'OPTION_ID_NOT_FOUND',
  duplicate_source_key: 'DUPLICATE_SOURCE_KEY_IN_BATCH',
  source_key_already_exists: 'SOURCE_KEY_ALREADY_EXISTS',
};

function compareImportErrors(
  left: ExerciseImportError,
  right: ExerciseImportError,
): number {
  return (
    left.rowNumber - right.rowNumber ||
    left.path.localeCompare(right.path) ||
    left.code.localeCompare(right.code)
  );
}

function parseImportIdempotencyKey(value: string | undefined): string {
  if (
    !value ||
    value.length < 8 ||
    value.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)
  ) {
    throw new UnprocessableEntityException(
      'A valid Idempotency-Key header is required.',
    );
  }
  return value;
}

function extractSummarySourceKeys(summary: Prisma.JsonValue): string[] {
  if (
    summary === null ||
    typeof summary !== 'object' ||
    Array.isArray(summary) ||
    !Array.isArray(summary.sourceKeys) ||
    summary.sourceKeys.some((value) => typeof value !== 'string')
  ) {
    throw new ConflictException(
      'Committed import provenance is incomplete; manual review is required.',
    );
  }
  return summary.sourceKeys as string[];
}
