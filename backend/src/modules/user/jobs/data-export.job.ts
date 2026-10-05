import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { Prisma } from '@prisma/client';

import {
  JOB_NAMES,
  PG_BOSS_INSTANCE,
} from '../../../infrastructure/jobs/job-queue.port';
import {
  MAX_PRIVATE_MEDIA_OBJECT_BYTES,
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../../../infrastructure/storage/object-storage.port';
import { PrismaService } from '../../../prisma/prisma.service';
import type { PgBoss } from 'pg-boss' with { 'resolution-mode': 'import' };

export interface DataExportJobPayload {
  exportId: number;
}

export interface ExcludedModelCoverage {
  model: string;
  reason: string;
}

export interface ExportCoverage {
  included: readonly string[];
  excluded: readonly ExcludedModelCoverage[];
}

export const EXPORT_COVERAGE: ExportCoverage = {
  included: [
    'User',
    'UserProfile',
    'UserSession',
    'UserGoal',
    'PlacementAttempt',
    'LearningPlan',
    'Consent',
    'DataExportJob',
    'AccountDeletionRequest',
    'LessonExerciseAttempt',
    'Progress',
    'UserTopicProgress',
    'LearningEvent',
    'UserWord',
    'UserWordProgress',
    'ReviewCard',
    'ReviewSession',
    'PronunciationAttempt',
    'ExamAttempt',
    'Result',
    'AuditLog',
    'ExamAnswer',
    'ExamAttemptEvent',
    'LearningPlanItem',
    'ReviewEvent',
    'ResultSkillScore',
  ],
  excluded: [
    {
      model: 'PasswordResetToken',
      reason:
        'Bảo mật: token đặt lại mật khẩu là thông tin xác thực bí mật (password)',
    },
    {
      model: 'EmailVerificationToken',
      reason: 'Bảo mật: token xác thực email là thông tin bảo mật bí mật',
    },
    {
      model: 'UserSession.tokenHash',
      reason:
        'Bảo mật: hash token của phiên đăng nhập là thông tin bảo mật bí mật (tokenHash)',
    },
    {
      model: 'DataSource',
      reason:
        'Nội dung CMS do ban biên tập quản lý, không phải dữ liệu cá nhân',
    },
    {
      model: 'Media',
      reason:
        'Media hệ thống do ban biên tập tải lên, không phải dữ liệu cá nhân',
    },
    {
      model: 'MediaIngestion',
      reason: 'Tiến trình kiểm duyệt media CMS, không phải dữ liệu cá nhân',
    },
    {
      model: 'MediaUploadRateLimit',
      reason:
        'Bộ đếm kỹ thuật rate limit upload CMS, không phải dữ liệu cá nhân',
    },
    {
      model: 'Level',
      reason: 'Danh mục cấp độ học HSK hệ thống, không phải dữ liệu cá nhân',
    },
    {
      model: 'Lesson',
      reason:
        'Nội dung bài học do ban biên tập soạn thảo, không phải dữ liệu cá nhân',
    },
    {
      model: 'Topic',
      reason: 'Chủ đề bài học hệ thống, không phải dữ liệu cá nhân',
    },
    {
      model: 'Story',
      reason: 'Truyện đọc bổ trợ hệ thống, không phải dữ liệu cá nhân',
    },
    {
      model: 'Word',
      reason: 'Từ vựng từ điển hệ thống, không phải dữ liệu cá nhân',
    },
    {
      model: 'Sentence',
      reason: 'Câu ví dụ hệ thống, không phải dữ liệu cá nhân',
    },
    {
      model: 'LessonExercise',
      reason: 'Bài tập bài học hệ thống, không phải dữ liệu cá nhân',
    },
    {
      model: 'ContentRevision',
      reason:
        'Lịch sử sửa đổi nội dung CMS của biên tập viên, không phải dữ liệu cá nhân',
    },
    {
      model: 'ContentReview',
      reason:
        'Phê duyệt nội dung CMS của kiểm duyệt viên, không phải dữ liệu cá nhân',
    },
    {
      model: 'ImportJob',
      reason: 'Tiến trình nhập dữ liệu CMS, không phải dữ liệu cá nhân',
    },
    {
      model: 'Question',
      reason: 'Câu hỏi đề thi hệ thống, không phải dữ liệu cá nhân',
    },
    {
      model: 'Test',
      reason: 'Đề thi thử hệ thống, không phải dữ liệu cá nhân',
    },
    {
      model: 'ExamAttemptSnapshot',
      reason:
        'Bản sao nội dung đề thi tại thời điểm thi, không phải dữ liệu người học tạo ra',
    },
  ],
} as const;

export function assertExportCoverageComplete(
  models: readonly Prisma.DMMF.Model[],
  coverage: ExportCoverage = EXPORT_COVERAGE,
): void {
  const coveredSet = new Set<string>([
    ...coverage.included,
    ...coverage.excluded.map((e) => e.model),
  ]);

  const includedSet = new Set<string>(coverage.included);

  // Thuật toán fixpoint xác định các model thuộc người dùng:
  // (a) Có field userId hoặc quan hệ phía con tới User
  const userModels = new Set<string>();
  for (const model of models) {
    const hasUserIdField = model.fields.some((f) => f.name === 'userId');
    const hasUserRelation = model.fields.some(
      (f) =>
        f.type === 'User' &&
        f.relationFromFields &&
        f.relationFromFields.length > 0,
    );
    if (hasUserIdField || hasUserRelation) {
      userModels.add(model.name);
    }
  }

  // (b) Có quan hệ phía con (relationFromFields không rỗng) tới một model nằm trong included
  // Lặp tới khi tập không đổi (fixpoint)
  let changed = true;
  while (changed) {
    changed = false;
    for (const model of models) {
      if (userModels.has(model.name)) {
        continue;
      }
      const hasChildRelationToIncluded = model.fields.some(
        (f) =>
          f.relationFromFields &&
          f.relationFromFields.length > 0 &&
          includedSet.has(f.type),
      );
      if (hasChildRelationToIncluded) {
        userModels.add(model.name);
        changed = true;
      }
    }
  }

  const unclassified: string[] = [];
  for (const modelName of userModels) {
    if (!coveredSet.has(modelName)) {
      unclassified.push(modelName);
    }
  }

  if (unclassified.length > 0) {
    throw new Error(
      `Unclassified models in export coverage: ${unclassified.sort().join(', ')}`,
    );
  }
}

@Injectable()
export class DataExportJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(DataExportJob.name);

  constructor(
    @Inject(PG_BOSS_INSTANCE) private readonly boss: PgBoss | null,
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.boss) return;

    await this.boss.work(JOB_NAMES.DATA_EXPORT, async (jobs) => {
      for (const job of jobs) {
        await this.process(job.data as DataExportJobPayload, job.id);
      }
    });
  }

  async process(data: DataExportJobPayload, jobId?: string): Promise<boolean> {
    const exportId = data?.exportId;
    if (typeof exportId !== 'number') {
      return false;
    }

    // 1. Lock row FOR UPDATE and verify status
    const exportJob = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: number;
          userId: number;
          status: string;
        }>
      >(Prisma.sql`
        SELECT id, "userId", status
        FROM "DataExportJob"
        WHERE id = ${exportId}
        FOR UPDATE
      `);

      if (rows.length === 0) {
        this.logger.warn(
          `Data export job not found (exportId: ${exportId}, jobId: ${jobId ?? 'unknown'})`,
        );
        return null;
      }

      const jobRow = rows[0];
      if (jobRow.status !== 'requested' && jobRow.status !== 'processing') {
        // Idempotent: already completed or failed
        return null;
      }

      await tx.$executeRaw(Prisma.sql`
        UPDATE "DataExportJob"
        SET status = 'processing',
            "startedAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ${exportId}
      `);

      return jobRow;
    });

    if (!exportJob) {
      return true;
    }

    const userId = exportJob.userId;

    // 2. Read snapshot in RepeatableRead isolation level
    try {
      const snapshotResult = await this.prisma.$transaction(
        async (tx) => {
          // Read user basic info
          const userRows = await tx.$queryRaw<
            Array<{
              id: number;
              email: string;
              name: string | null;
              createdAt: Date;
              emailVerifiedAt: Date | null;
            }>
          >(Prisma.sql`
            SELECT id, email, name, "createdAt", "emailVerifiedAt"
            FROM "User"
            WHERE id = ${userId}
          `);

          if (userRows.length === 0) {
            throw new Error(`User not found for data export: ${userId}`);
          }
          const user = userRows[0];

          // Read user profile
          const profileRows = await tx.$queryRaw<
            Array<{
              displayName: string | null;
              locale: string;
              timezone: string;
              createdAt: Date;
              updatedAt: Date;
            }>
          >(Prisma.sql`
            SELECT "displayName", locale, timezone, "createdAt", "updatedAt"
            FROM "UserProfile"
            WHERE "userId" = ${userId}
          `);

          // Read user sessions (without secret credentials)
          const sessionRows = await tx.$queryRaw<
            Array<{
              createdAt: Date;
              lastSeenAt: Date | null;
              expiresAt: Date;
              revokedAt: Date | null;
              userAgent: string | null;
              ipAddress: string | null;
            }>
          >(Prisma.sql`
            SELECT "createdAt", "lastSeenAt", "expiresAt", "revokedAt", "userAgent", "ipAddress"
            FROM "UserSession"
            WHERE "userId" = ${userId}
            ORDER BY "createdAt" DESC
          `);

          // Read user goals
          const goalRows = await tx.$queryRaw<
            Array<{
              id: number;
              targetLevelId: number;
              targetBand: number | null;
              dailyMinutes: number;
              learningPurpose: string | null;
              reminderEnabled: boolean;
              reminderTime: Date | null;
              startDate: Date;
              isActive: boolean;
              createdAt: Date;
              updatedAt: Date;
            }>
          >(Prisma.sql`
            SELECT id, "targetLevelId", "targetBand", "dailyMinutes", "learningPurpose", "reminderEnabled", "reminderTime", "startDate", "isActive", "createdAt", "updatedAt"
            FROM "UserGoal"
            WHERE "userId" = ${userId}
            ORDER BY "createdAt" DESC
          `);

          // Read placement attempts
          const placementRows = await tx.$queryRaw<
            Array<{
              id: number;
              score: number;
              detailSnapshot: unknown;
              recommendedLevelId: number;
              recommendedBand: number | null;
              startedAt: Date;
              completedAt: Date | null;
              createdAt: Date;
              updatedAt: Date;
            }>
          >(Prisma.sql`
            SELECT id, score, "detailSnapshot", "recommendedLevelId", "recommendedBand", "startedAt", "completedAt", "createdAt", "updatedAt"
            FROM "PlacementAttempt"
            WHERE "userId" = ${userId}
            ORDER BY "createdAt" DESC
          `);

          // Read learning plans
          const planRows = await tx.$queryRaw<
            Array<{
              id: number;
              targetLevelId: number;
              targetBand: number | null;
              generatedFromPlacementId: number | null;
              startDate: Date;
              endDate: Date | null;
              createdAt: Date;
              updatedAt: Date;
            }>
          >(Prisma.sql`
            SELECT id, "targetLevelId", "targetBand", "generatedFromPlacementId", "startDate", "endDate", "createdAt", "updatedAt"
            FROM "LearningPlan"
            WHERE "userId" = ${userId}
            ORDER BY "createdAt" DESC
          `);

          // Read learning plan items (child of LearningPlan)
          const planItemRows = await tx.$queryRaw<
            Array<{
              id: number;
              learningPlanId: number;
              lessonId: number;
              orderIndex: number;
              scheduledDate: Date;
              status: string;
              startedAt: Date | null;
              completedAt: Date | null;
              createdAt: Date;
              updatedAt: Date;
            }>
          >(Prisma.sql`
            SELECT id, "learningPlanId", "lessonId", "orderIndex", "scheduledDate", status, "startedAt", "completedAt", "createdAt", "updatedAt"
            FROM "LearningPlanItem"
            WHERE "learningPlanId" IN (
              SELECT id FROM "LearningPlan" WHERE "userId" = ${userId}
            )
            ORDER BY "learningPlanId" ASC, "orderIndex" ASC
          `);
          const planItemsMap = new Map<number, typeof planItemRows>();
          for (const item of planItemRows) {
            const list = planItemsMap.get(item.learningPlanId) ?? [];
            list.push(item);
            planItemsMap.set(item.learningPlanId, list);
          }
          const enrichedPlans = planRows.map((p) => ({
            ...p,
            items: planItemsMap.get(p.id) ?? [],
          }));

          // Read consents
          const consentRows = await tx.$queryRaw<
            Array<{
              id: number;
              type: string;
              consentVersion: string;
              policyVersion: string;
              grantedAt: Date;
              revokedAt: Date | null;
              createdAt: Date;
              updatedAt: Date;
            }>
          >(Prisma.sql`
            SELECT id, type, "consentVersion", "policyVersion", "grantedAt", "revokedAt", "createdAt", "updatedAt"
            FROM "Consent"
            WHERE "userId" = ${userId}
            ORDER BY "createdAt" DESC
          `);

          // Read data export jobs
          const exportRows = await tx.$queryRaw<
            Array<{
              id: number;
              status: string;
              outputExpiresAt: Date | null;
              startedAt: Date | null;
              completedAt: Date | null;
              createdAt: Date;
              updatedAt: Date;
            }>
          >(Prisma.sql`
            SELECT id, status, "outputExpiresAt", "startedAt", "completedAt", "createdAt", "updatedAt"
            FROM "DataExportJob"
            WHERE "userId" = ${userId}
            ORDER BY "createdAt" DESC
          `);

          // Read account deletion requests
          const deletionRows = await tx.$queryRaw<
            Array<{
              id: number;
              status: string;
              scheduledAt: Date;
              completedAt: Date | null;
              cancelledAt: Date | null;
              createdAt: Date;
              updatedAt: Date;
            }>
          >(Prisma.sql`
            SELECT id, status, "scheduledAt", "completedAt", "cancelledAt", "createdAt", "updatedAt"
            FROM "AccountDeletionRequest"
            WHERE "userId" = ${userId}
            ORDER BY "createdAt" DESC
          `);

          // Read lesson exercise attempts
          const exerciseAttemptRows = await tx.$queryRaw<
            Array<{
              id: number;
              exerciseId: number;
              attemptNumber: number;
              answer: unknown;
              contentSnapshot: unknown;
              exerciseVersion: number;
              isCorrect: boolean;
              score: number;
              durationSeconds: number;
              detailJson: unknown;
              feedbackVersion: number;
              submittedAt: Date;
              createdAt: Date;
            }>
          >(Prisma.sql`
            SELECT id, "exerciseId", "attemptNumber", answer, "contentSnapshot", "exerciseVersion", "isCorrect", score, "durationSeconds", "detailJson", "feedbackVersion", "submittedAt", "createdAt"
            FROM "LessonExerciseAttempt"
            WHERE "userId" = ${userId}
            ORDER BY "createdAt" DESC
          `);

          // Read progresses
          const progressRows = await tx.$queryRaw<
            Array<{
              id: number;
              lessonId: number;
              status: string;
              score: number;
              completionPercent: number;
              currentTopicId: number | null;
              currentExerciseId: number | null;
              timeSpentSeconds: number;
              startedAt: Date | null;
              completedAt: Date | null;
              lastActivityAt: Date | null;
              createdAt: Date;
              updatedAt: Date;
            }>
          >(Prisma.sql`
            SELECT id, "lessonId", status, score, "completionPercent", "currentTopicId", "currentExerciseId", "timeSpentSeconds", "startedAt", "completedAt", "lastActivityAt", "createdAt", "updatedAt"
            FROM "Progress"
            WHERE "userId" = ${userId}
            ORDER BY "createdAt" DESC
          `);

          // Read user topic progresses
          const topicProgressRows = await tx.$queryRaw<
            Array<{
              id: number;
              topicId: number;
              status: string;
              completionPercent: number;
              timeSpentSeconds: number;
              startedAt: Date | null;
              completedAt: Date | null;
              lastActivityAt: Date | null;
              createdAt: Date;
              updatedAt: Date;
            }>
          >(Prisma.sql`
            SELECT id, "topicId", status, "completionPercent", "timeSpentSeconds", "startedAt", "completedAt", "lastActivityAt", "createdAt", "updatedAt"
            FROM "UserTopicProgress"
            WHERE "userId" = ${userId}
            ORDER BY "createdAt" DESC
          `);

          // Read user words
          const userWordRows = await tx.$queryRaw<
            Array<{
              id: number;
              wordId: number;
              createdAt: Date;
            }>
          >(Prisma.sql`
            SELECT id, "wordId", "createdAt"
            FROM "UserWord"
            WHERE "userId" = ${userId}
            ORDER BY "createdAt" DESC
          `);

          // Read user word progresses
          const wordProgressRows = await tx.$queryRaw<
            Array<{
              id: number;
              wordId: number;
              status: string;
              createdAt: Date;
              updatedAt: Date;
            }>
          >(Prisma.sql`
            SELECT id, "wordId", status, "createdAt", "updatedAt"
            FROM "UserWordProgress"
            WHERE "userId" = ${userId}
            ORDER BY "createdAt" DESC
          `);

          // Read review cards
          const reviewCardRows = await tx.$queryRaw<
            Array<{
              id: number;
              wordId: number;
              state: string;
              dueAt: Date;
              intervalDays: number;
              easeFactor: number;
              repetitions: number;
              lapses: number;
              lastReviewedAt: Date | null;
              schedulerVersion: string;
              createdAt: Date;
              updatedAt: Date;
            }>
          >(Prisma.sql`
            SELECT id, "wordId", state, "dueAt", "intervalDays", "easeFactor", repetitions, lapses, "lastReviewedAt", "schedulerVersion", "createdAt", "updatedAt"
            FROM "ReviewCard"
            WHERE "userId" = ${userId}
            ORDER BY "createdAt" DESC
          `);

          // Read review events in batches of 1000 (child of ReviewCard)
          // Technical fields excluded: idempotencyKey
          // BigInt id serialized to String
          const reviewEventsMap = new Map<
            number,
            Array<{
              id: string;
              cardId: number;
              sessionId: number | null;
              grade: string;
              previousState: string;
              nextState: string;
              previousDueAt: Date;
              nextDueAt: Date;
              previousIntervalDays: number;
              nextIntervalDays: number;
              previousEaseFactor: number;
              nextEaseFactor: number;
              durationMs: number | null;
              reviewedAt: Date;
              createdAt: Date;
            }>
          >();
          let lastReviewEventId = 0n;
          let estimatedBytes = 0;

          while (true) {
            const eventBatch = await tx.$queryRaw<
              Array<{
                id: bigint;
                cardId: number;
                sessionId: number | null;
                grade: string;
                previousState: string;
                nextState: string;
                previousDueAt: Date;
                nextDueAt: Date;
                previousIntervalDays: number;
                nextIntervalDays: number;
                previousEaseFactor: number;
                nextEaseFactor: number;
                durationMs: number | null;
                reviewedAt: Date;
                createdAt: Date;
              }>
            >(Prisma.sql`
              SELECT id, "cardId", "sessionId", grade, "previousState", "nextState",
                     "previousDueAt", "nextDueAt", "previousIntervalDays", "nextIntervalDays",
                     "previousEaseFactor", "nextEaseFactor", "durationMs", "reviewedAt", "createdAt"
              FROM "ReviewEvent"
              WHERE "cardId" IN (
                SELECT id FROM "ReviewCard" WHERE "userId" = ${userId}
              ) AND id > ${lastReviewEventId}
              ORDER BY id ASC
              LIMIT 1000
            `);

            if (eventBatch.length === 0) {
              break;
            }

            lastReviewEventId = eventBatch[eventBatch.length - 1].id;
            const mappedBatch = eventBatch.map((evt) => ({
              ...evt,
              id: evt.id.toString(),
            }));
            const batchBytes = Buffer.byteLength(
              JSON.stringify(mappedBatch),
              'utf8',
            );
            estimatedBytes += batchBytes;
            if (estimatedBytes > MAX_PRIVATE_MEDIA_OBJECT_BYTES) {
              return { tooLarge: true, exportPayload: null };
            }

            for (const evt of mappedBatch) {
              const list = reviewEventsMap.get(evt.cardId) ?? [];
              list.push(evt);
              reviewEventsMap.set(evt.cardId, list);
            }
          }

          const enrichedReviewCards = reviewCardRows.map((c) => ({
            ...c,
            events: reviewEventsMap.get(c.id) ?? [],
          }));

          // Read review sessions
          const reviewSessionRows = await tx.$queryRaw<
            Array<{
              id: number;
              status: string;
              mode: string;
              plannedCount: number;
              reviewedCount: number;
              summary: unknown;
              startedAt: Date;
              completedAt: Date | null;
              createdAt: Date;
              updatedAt: Date;
            }>
          >(Prisma.sql`
            SELECT id, status, mode, "plannedCount", "reviewedCount", summary, "startedAt", "completedAt", "createdAt", "updatedAt"
            FROM "ReviewSession"
            WHERE "userId" = ${userId}
            ORDER BY "createdAt" DESC
          `);

          // Read pronunciation attempts
          const pronunciationRows = await tx.$queryRaw<
            Array<{
              id: number;
              practiceId: number;
              audioId: number | null;
              score: number;
              detailJson: unknown;
              createdAt: Date;
            }>
          >(Prisma.sql`
            SELECT id, "practiceId", "audioId", score, "detailJson", "createdAt"
            FROM "PronunciationAttempt"
            WHERE "userId" = ${userId}
            ORDER BY "createdAt" DESC
          `);

          // Read exam attempts
          const examAttemptRows = await tx.$queryRaw<
            Array<{
              id: number;
              testId: number;
              status: string;
              startedAt: Date;
              expiresAt: Date;
              submittedAt: Date | null;
              remainingSeconds: number | null;
              score: number | null;
              maxScore: number;
              snapshotVersion: number;
              scoringVersion: string;
              createdAt: Date;
              updatedAt: Date;
            }>
          >(Prisma.sql`
            SELECT id, "testId", status, "startedAt", "expiresAt", "submittedAt", "remainingSeconds", score, "maxScore", "snapshotVersion", "scoringVersion", "createdAt", "updatedAt"
            FROM "ExamAttempt"
            WHERE "userId" = ${userId}
            ORDER BY "createdAt" DESC
          `);

          // Read exam attempt events (child of ExamAttempt)
          // Technical fields excluded: idempotencyKey
          // BigInt id serialized to String
          const examAttemptEventRows = await tx.$queryRaw<
            Array<{
              id: bigint;
              attemptId: number;
              type: string;
              metadata: unknown;
              occurredAt: Date;
              createdAt: Date;
            }>
          >(Prisma.sql`
            SELECT id, "attemptId", type, metadata, "occurredAt", "createdAt"
            FROM "ExamAttemptEvent"
            WHERE "attemptId" IN (
              SELECT id FROM "ExamAttempt" WHERE "userId" = ${userId}
            )
            ORDER BY "attemptId" ASC, id ASC
          `);
          const examAttemptEventsMap = new Map<
            number,
            Array<{
              id: string;
              attemptId: number;
              type: string;
              metadata: unknown;
              occurredAt: Date;
              createdAt: Date;
            }>
          >();
          for (const evt of examAttemptEventRows) {
            const mapped = {
              ...evt,
              id: evt.id.toString(),
            };
            const list = examAttemptEventsMap.get(evt.attemptId) ?? [];
            list.push(mapped);
            examAttemptEventsMap.set(evt.attemptId, list);
          }

          // Read exam answers in batches of 1000 (child of ExamAttempt)
          // Technical fields excluded: saveIdempotencyKey
          const examAnswersMap = new Map<
            number,
            Array<{
              id: number;
              attemptId: number;
              snapshotQuestionKey: string;
              questionId: number | null;
              answer: unknown;
              isFlagged: boolean;
              answeredAt: Date | null;
              lastSavedAt: Date;
              version: number;
              score: number | null;
              detailJson: unknown;
              createdAt: Date;
              updatedAt: Date;
            }>
          >();
          let lastExamAnswerId = 0;

          while (true) {
            const answerBatch = await tx.$queryRaw<
              Array<{
                id: number;
                attemptId: number;
                snapshotQuestionKey: string;
                questionId: number | null;
                answer: unknown;
                isFlagged: boolean;
                answeredAt: Date | null;
                lastSavedAt: Date;
                version: number;
                score: number | null;
                detailJson: unknown;
                createdAt: Date;
                updatedAt: Date;
              }>
            >(Prisma.sql`
              SELECT id, "attemptId", "snapshotQuestionKey", "questionId", answer, "isFlagged",
                     "answeredAt", "lastSavedAt", version, score, "detailJson", "createdAt", "updatedAt"
              FROM "ExamAnswer"
              WHERE "attemptId" IN (
                SELECT id FROM "ExamAttempt" WHERE "userId" = ${userId}
              ) AND id > ${lastExamAnswerId}
              ORDER BY id ASC
              LIMIT 1000
            `);

            if (answerBatch.length === 0) {
              break;
            }

            lastExamAnswerId = answerBatch[answerBatch.length - 1].id;
            const batchBytes = Buffer.byteLength(
              JSON.stringify(answerBatch),
              'utf8',
            );
            estimatedBytes += batchBytes;
            if (estimatedBytes > MAX_PRIVATE_MEDIA_OBJECT_BYTES) {
              return { tooLarge: true, exportPayload: null };
            }

            for (const ans of answerBatch) {
              const list = examAnswersMap.get(ans.attemptId) ?? [];
              list.push(ans);
              examAnswersMap.set(ans.attemptId, list);
            }
          }

          const enrichedExamAttempts = examAttemptRows.map((att) => ({
            ...att,
            answers: examAnswersMap.get(att.id) ?? [],
            events: examAttemptEventsMap.get(att.id) ?? [],
          }));

          // Read exam results
          const resultRows = await tx.$queryRaw<
            Array<{
              id: number;
              testId: number;
              attemptId: number;
              score: number;
              awardedBand: number;
              scoringVersion: string;
              detailJson: unknown;
              publishedAt: Date | null;
              createdAt: Date;
            }>
          >(Prisma.sql`
            SELECT id, "testId", "attemptId", score, "awardedBand", "scoringVersion", "detailJson", "publishedAt", "createdAt"
            FROM "Result"
            WHERE "userId" = ${userId}
            ORDER BY "createdAt" DESC
          `);

          // Read result skill scores (child of Result)
          const skillScoreRows = await tx.$queryRaw<
            Array<{
              id: number;
              resultId: number;
              skill: string;
              score: number;
              total: number;
            }>
          >(Prisma.sql`
            SELECT id, "resultId", skill, score, total
            FROM "ResultSkillScore"
            WHERE "resultId" IN (
              SELECT id FROM "Result" WHERE "userId" = ${userId}
            )
            ORDER BY "resultId" ASC, id ASC
          `);
          const skillScoresMap = new Map<number, typeof skillScoreRows>();
          for (const item of skillScoreRows) {
            const list = skillScoresMap.get(item.resultId) ?? [];
            list.push(item);
            skillScoresMap.set(item.resultId, list);
          }
          const enrichedResults = resultRows.map((r) => ({
            ...r,
            skillScores: skillScoresMap.get(r.id) ?? [],
          }));

          // Read audit logs (only action + createdAt)
          const auditLogRows = await tx.$queryRaw<
            Array<{
              action: string;
              createdAt: Date;
            }>
          >(Prisma.sql`
            SELECT action, "createdAt"
            FROM "AuditLog"
            WHERE "actorId" = ${userId}
            ORDER BY "createdAt" DESC
          `);

          // Base data snapshot
          const staticExportData = {
            user,
            profile: profileRows[0] ?? null,
            sessions: sessionRows,
            goals: goalRows,
            placementAttempts: placementRows,
            learningPlans: enrichedPlans,
            consents: consentRows,
            dataExportJobs: exportRows,
            accountDeletionRequests: deletionRows,
            lessonExerciseAttempts: exerciseAttemptRows,
            progresses: progressRows,
            topicProgresses: topicProgressRows,
            userWords: userWordRows,
            wordProgresses: wordProgressRows,
            reviewCards: enrichedReviewCards,
            reviewSessions: reviewSessionRows,
            pronunciationAttempts: pronunciationRows,
            examAttempts: enrichedExamAttempts,
            results: enrichedResults,
            auditLogs: auditLogRows,
          };

          estimatedBytes = Buffer.byteLength(
            JSON.stringify(staticExportData),
            'utf8',
          );

          if (estimatedBytes > MAX_PRIVATE_MEDIA_OBJECT_BYTES) {
            return { tooLarge: true, exportPayload: null };
          }

          // 4. Batch reading of LearningEvent (batches of 1000)
          const learningEvents: unknown[] = [];
          let lastEventId = 0;

          while (true) {
            const eventBatch = await tx.$queryRaw<
              Array<{
                id: number;
                type: string;
                lessonId: number | null;
                topicId: number | null;
                exerciseId: number | null;
                attemptId: number | null;
                resourceType: string | null;
                resourceId: number | null;
                metadata: unknown;
                occurredAt: Date;
                createdAt: Date;
              }>
            >(Prisma.sql`
              SELECT
                id, type, "lessonId", "topicId", "exerciseId", "attemptId",
                "resourceType", "resourceId", metadata, "occurredAt", "createdAt"
              FROM "LearningEvent"
              WHERE "userId" = ${userId} AND id > ${lastEventId}
              ORDER BY id ASC
              LIMIT 1000
            `);

            if (eventBatch.length === 0) {
              break;
            }

            lastEventId = eventBatch[eventBatch.length - 1].id;
            const batchJsonBytes = Buffer.byteLength(
              JSON.stringify(eventBatch),
              'utf8',
            );
            estimatedBytes += batchJsonBytes;

            if (estimatedBytes > MAX_PRIVATE_MEDIA_OBJECT_BYTES) {
              return { tooLarge: true, exportPayload: null };
            }

            learningEvents.push(...eventBatch);
          }

          const completePayload = {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            ...staticExportData,
            learningEvents,
          };

          return { tooLarge: false, exportPayload: completePayload };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        },
      );

      if (snapshotResult.tooLarge || !snapshotResult.exportPayload) {
        await this.prisma.$executeRaw(Prisma.sql`
          UPDATE "DataExportJob"
          SET status = 'failed',
              "errorCode" = 'EXPORT_TOO_LARGE',
              "errorMessage" = 'Export size exceeded 10MB limit',
              "completedAt" = CURRENT_TIMESTAMP,
              "updatedAt" = CURRENT_TIMESTAMP
          WHERE id = ${exportId}
        `);
        return true;
      }

      // Serialize and check exact byte buffer size
      const jsonBytes = Buffer.from(
        JSON.stringify(snapshotResult.exportPayload),
        'utf8',
      );

      if (jsonBytes.length > MAX_PRIVATE_MEDIA_OBJECT_BYTES) {
        await this.prisma.$executeRaw(Prisma.sql`
          UPDATE "DataExportJob"
          SET status = 'failed',
              "errorCode" = 'EXPORT_TOO_LARGE',
              "errorMessage" = 'Export size exceeded 10MB limit',
              "completedAt" = CURRENT_TIMESTAMP,
              "updatedAt" = CURRENT_TIMESTAMP
          WHERE id = ${exportId}
        `);
        return true;
      }

      // 5. Store in private object storage
      const randomHex = crypto.randomBytes(16).toString('hex');
      const storageKey = `privacy-exports/${userId}/${exportId}-${randomHex}.json`;
      const checksum = crypto
        .createHash('sha256')
        .update(jsonBytes)
        .digest('hex');

      await this.storage.putPrivateObject({
        key: storageKey,
        body: jsonBytes,
        contentType: 'application/json',
        checksum,
      });

      // 6. Mark completed
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE "DataExportJob"
        SET status = 'completed',
            "outputStorageKey" = ${storageKey},
            "completedAt" = CURRENT_TIMESTAMP,
            "outputExpiresAt" = CURRENT_TIMESTAMP + INTERVAL '24 hours',
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ${exportId}
      `);

      return true;
    } catch (error: unknown) {
      this.logger.error(
        `Data export failed (exportId: ${exportId}, jobId: ${jobId ?? 'unknown'}, error: ${error instanceof Error ? error.name : 'UnknownError'})`,
      );
      throw error;
    }
  }
}
