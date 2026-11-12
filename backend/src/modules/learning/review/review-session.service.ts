import {
  HttpException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ReviewEvent, ReviewSession } from '@prisma/client';

import type { ApiSuccessResponse } from '../../../common/interfaces/api-response.interface';
import {
  toWordDetail,
  WORD_DETAIL_INCLUDE,
} from '../../dictionary/dictionary-word.mapper';
import { PrismaService } from '../../../prisma/prisma.service';
import { parseIdempotencyKey } from '../activity/lesson-activity-idempotency';
import { classifyLessonActivityPersistenceError } from '../activity/lesson-activity-persistence';
import { schedule, SM2_V1_POLICY } from '../srs';
import type {
  CompleteReviewSessionResponseDto,
  CreateReviewSessionResponseDto,
  CurrentReviewSessionResponseDto,
  GradeReviewCardDto,
  GradeReviewCardResponseDto,
  ReviewSessionDto,
  ReviewSessionSummaryDto,
} from './dto/review-session.dto';
import { reviewErrors } from './review-errors';
import { buildReviewPreview } from './review-preview';
import { activeCardWhere, DUE_CARD_ORDER, dueCardWhere } from './review-queue';
import {
  buildSessionSummary,
  isSessionExpired,
  type ReviewSessionSummary,
  sessionExpiresAt,
} from './review-session-rules';

/** `ReviewSession.mode` of a session built from the due queue. */
const DUE_MODE = 'due';

/** What `summary` holds: the card snapshot (Q254), then the result on complete. */
type StoredSummary = {
  cardIds: number[];
  requestedLimit: number;
} & Partial<ReviewSessionSummary>;

/**
 * The callback's answer. `fail` is thrown only after the transaction commits,
 * so a lazy `abandoned` write survives the error that follows it (Q253).
 */
type TxResult<T> = { value: T } | { fail: HttpException };

type LastActivity = Pick<ReviewSession, 'id' | 'startedAt'>;

function storedSummary(session: Pick<ReviewSession, 'summary'>): StoredSummary {
  const value = session.summary;
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Array.isArray(value.cardIds)
  ) {
    throw new InternalServerErrorException('Review session is malformed.');
  }
  return value as StoredSummary;
}

@Injectable()
export class ReviewSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(
    userId: number,
    limit: number,
    rawKey: unknown,
  ): Promise<ApiSuccessResponse<CreateReviewSessionResponseDto>> {
    const idempotencyKey = parseIdempotencyKey(rawKey);
    const data = await this.run<CreateReviewSessionResponseDto>(async (tx) => {
      await this.lockActiveUser(tx, userId);
      const now = new Date();

      const replay = await tx.reviewSession.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
      });
      if (replay) {
        if (storedSummary(replay).requestedLimit !== limit) {
          return { fail: reviewErrors.idempotencyKeyReused() };
        }
        let session = replay;
        // A write route stores the lazy expiry it meets (Q253).
        if (
          replay.status === 'in_progress' &&
          isSessionExpired(await this.lastActivity(tx, replay), now)
        ) {
          session = await tx.reviewSession.update({
            where: { id: replay.id },
            data: { status: 'abandoned' },
          });
        }
        return {
          value: { created: false, session: await this.view(tx, session) },
        };
      }

      const live = await tx.reviewSession.findFirst({
        where: { userId, status: 'in_progress' },
        orderBy: { id: 'desc' },
      });
      if (live) {
        if (isSessionExpired(await this.lastActivity(tx, live), now)) {
          await tx.reviewSession.update({
            where: { id: live.id },
            data: { status: 'abandoned' },
          });
        } else {
          return {
            value: { created: false, session: await this.view(tx, live) },
          };
        }
      }

      const due = await tx.reviewCard.findMany({
        where: dueCardWhere(userId, now),
        orderBy: [...DUE_CARD_ORDER],
        take: limit,
        select: { id: true },
      });
      if (due.length === 0) return { fail: reviewErrors.nothingDue() };

      const cardIds = due.map((card) => card.id);
      const summary: StoredSummary = { cardIds, requestedLimit: limit };
      const created = await tx.reviewSession.create({
        data: {
          userId,
          status: 'in_progress',
          mode: DUE_MODE,
          plannedCount: cardIds.length,
          reviewedCount: 0,
          idempotencyKey,
          summary,
          startedAt: now,
        },
      });
      return {
        value: { created: true, session: this.toView(created, now) },
      };
    });
    return { success: true, data };
  }

  /** Read only: an expired session is reported as absent, never written. */
  async getCurrentSession(
    userId: number,
    now: Date,
  ): Promise<ApiSuccessResponse<CurrentReviewSessionResponseDto>> {
    const data = await this.prisma.$transaction(
      async (tx) => {
        const live = await tx.reviewSession.findFirst({
          where: { userId, status: 'in_progress' },
          orderBy: { id: 'desc' },
        });
        if (!live) throw reviewErrors.sessionNotFound();
        const lastActivityAt = await this.lastActivity(tx, live);
        if (isSessionExpired(lastActivityAt, now)) {
          throw reviewErrors.sessionNotFound();
        }

        const graded = await tx.reviewEvent.findMany({
          where: { sessionId: live.id },
          select: { cardId: true },
        });
        const gradedIds = new Set(graded.map((event) => event.cardId));
        const cardIds = storedSummary(live).cardIds;
        const pending = cardIds.filter((id) => !gradedIds.has(id));
        const cards = await tx.reviewCard.findMany({
          where: { id: { in: pending }, ...activeCardWhere(userId) },
          include: { word: { include: WORD_DETAIL_INCLUDE } },
        });
        const byId = new Map(cards.map((card) => [card.id, card]));
        const items = pending.flatMap((id) => {
          const card = byId.get(id);
          return card
            ? [
                {
                  cardId: card.id,
                  state: card.state,
                  dueAt: card.dueAt,
                  word: toWordDetail(card.word),
                  preview: buildReviewPreview(card, now),
                },
              ]
            : [];
        });
        return { session: this.toView(live, lastActivityAt), items };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return { success: true, data };
  }

  async gradeCard(
    userId: number,
    sessionId: number,
    body: GradeReviewCardDto,
    rawKey: unknown,
  ): Promise<ApiSuccessResponse<GradeReviewCardResponseDto>> {
    const idempotencyKey = parseIdempotencyKey(rawKey);
    const durationMs = body.durationMs ?? null;
    const data = await this.run<GradeReviewCardResponseDto>(async (tx) => {
      // Lock order (Q254): the session row, then the card row.
      const session = await this.lockSession(tx, userId, sessionId);
      if (!session) return { fail: reviewErrors.sessionNotFound() };
      const [card] = await tx.$queryRaw<Array<{ id: number }>>(
        Prisma.sql`SELECT id FROM "ReviewCard" WHERE id = ${body.cardId} AND "userId" = ${userId} FOR UPDATE`,
      );
      const now = new Date();

      const replay = await tx.reviewEvent.findFirst({
        where: { sessionId, idempotencyKey },
      });
      if (replay) {
        if (
          replay.cardId !== body.cardId ||
          replay.grade !== body.grade ||
          replay.durationMs !== durationMs
        ) {
          return { fail: reviewErrors.idempotencyKeyReused() };
        }
        return { value: this.gradeResult(true, replay, session) };
      }

      if (session.status !== 'in_progress') {
        return { fail: reviewErrors.sessionNotActive() };
      }
      if (isSessionExpired(await this.lastActivity(tx, session), now)) {
        await tx.reviewSession.update({
          where: { id: session.id },
          data: { status: 'abandoned' },
        });
        return { fail: reviewErrors.sessionExpired() };
      }
      if (!storedSummary(session).cardIds.includes(body.cardId)) {
        return { fail: reviewErrors.cardNotInSession() };
      }
      const already = await tx.reviewEvent.findFirst({
        where: { sessionId, cardId: body.cardId },
        select: { id: true },
      });
      if (already) return { fail: reviewErrors.cardAlreadyReviewed() };
      // The event key is unique per card: a key spent in another session of
      // this card is a reused key, answered before the insert can collide.
      const spent = await tx.reviewEvent.findUnique({
        where: {
          cardId_idempotencyKey: { cardId: body.cardId, idempotencyKey },
        },
        select: { id: true },
      });
      if (spent) return { fail: reviewErrors.idempotencyKeyReused() };

      const current = card
        ? await tx.reviewCard.findFirst({
            where: { id: card.id, ...activeCardWhere(userId) },
          })
        : null;
      if (!current) return { fail: reviewErrors.cardUnavailable() };

      const next = schedule(current, body.grade, now, SM2_V1_POLICY);
      await tx.reviewCard.update({
        where: { id: current.id },
        data: {
          state: next.state,
          dueAt: next.dueAt,
          intervalDays: next.intervalDays,
          easeFactor: next.easeFactor,
          repetitions: next.repetitions,
          lapses: next.lapses,
          lastReviewedAt: next.lastReviewedAt,
          schedulerVersion: next.schedulerVersion,
        },
      });
      const event = await tx.reviewEvent.create({
        data: {
          cardId: current.id,
          sessionId: session.id,
          grade: body.grade,
          previousState: current.state,
          nextState: next.state,
          previousDueAt: current.dueAt,
          nextDueAt: next.dueAt,
          previousIntervalDays: current.intervalDays,
          nextIntervalDays: next.intervalDays,
          previousEaseFactor: current.easeFactor,
          nextEaseFactor: next.easeFactor,
          durationMs,
          source: 'flashcard',
          idempotencyKey,
          reviewedAt: now,
        },
      });
      const updated = await tx.reviewSession.update({
        where: { id: session.id },
        data: { reviewedCount: { increment: 1 } },
      });
      return { value: this.gradeResult(false, event, updated) };
    });
    return { success: true, data };
  }

  async completeSession(
    userId: number,
    sessionId: number,
  ): Promise<ApiSuccessResponse<CompleteReviewSessionResponseDto>> {
    const data = await this.run<CompleteReviewSessionResponseDto>(
      async (tx) => {
        const session = await this.lockSession(tx, userId, sessionId);
        if (!session) return { fail: reviewErrors.sessionNotFound() };
        const now = new Date();
        if (session.status === 'abandoned') {
          return { fail: reviewErrors.sessionNotActive() };
        }
        if (session.status === 'completed') {
          return {
            value: {
              session: this.toView(session, session.startedAt),
              summary: this.publicSummary(storedSummary(session)),
            },
          };
        }

        // A session past its idle window still completes (Q254).
        const events = await tx.reviewEvent.findMany({
          where: { sessionId },
          select: { grade: true, durationMs: true },
        });
        const result = buildSessionSummary(events);
        const completed = await tx.reviewSession.update({
          where: { id: sessionId },
          data: {
            status: 'completed',
            completedAt: now,
            summary: { ...storedSummary(session), ...result },
          },
        });
        return {
          value: {
            session: this.toView(completed, completed.startedAt),
            summary: result,
          },
        };
      },
    );
    return { success: true, data };
  }

  private publicSummary(stored: StoredSummary): ReviewSessionSummaryDto {
    return {
      again: stored.again ?? 0,
      hard: stored.hard ?? 0,
      good: stored.good ?? 0,
      easy: stored.easy ?? 0,
      remembered: stored.remembered ?? 0,
      forgot: stored.forgot ?? 0,
      retentionPercent: stored.retentionPercent ?? null,
      totalDurationMs: stored.totalDurationMs ?? 0,
    };
  }

  private gradeResult(
    replayed: boolean,
    event: Pick<
      ReviewEvent,
      'cardId' | 'grade' | 'nextState' | 'nextDueAt' | 'nextIntervalDays'
    >,
    session: Pick<ReviewSession, 'reviewedCount' | 'plannedCount'>,
  ): GradeReviewCardResponseDto {
    return {
      replayed,
      cardId: event.cardId,
      grade: event.grade,
      next: {
        state: event.nextState as GradeReviewCardResponseDto['next']['state'],
        dueAt: event.nextDueAt,
        intervalDays: event.nextIntervalDays,
      },
      session: {
        reviewedCount: session.reviewedCount,
        plannedCount: session.plannedCount,
      },
    };
  }

  /** Q253: the session's last grade, or its start without one. */
  private async lastActivity(
    tx: Prisma.TransactionClient,
    session: LastActivity,
  ): Promise<Date> {
    const last = await tx.reviewEvent.aggregate({
      where: { sessionId: session.id },
      _max: { reviewedAt: true },
    });
    return last._max.reviewedAt ?? session.startedAt;
  }

  private async view(
    tx: Prisma.TransactionClient,
    session: ReviewSession,
  ): Promise<ReviewSessionDto> {
    return this.toView(session, await this.lastActivity(tx, session));
  }

  private toView(
    session: ReviewSession,
    lastActivityAt: Date,
  ): ReviewSessionDto {
    const { status } = session;
    return {
      sessionId: session.id,
      status,
      plannedCount: session.plannedCount,
      reviewedCount: session.reviewedCount,
      startedAt: session.startedAt,
      expiresAt:
        status === 'in_progress' ? sessionExpiresAt(lastActivityAt) : null,
    };
  }

  private async lockActiveUser(
    tx: Prisma.TransactionClient,
    userId: number,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: number }>>(
      Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} AND status = 'active' AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (rows.length !== 1) {
      throw new UnauthorizedException('Account is not available.');
    }
  }

  /** The caller's session row, locked; null for a missing or foreign one. */
  private async lockSession(
    tx: Prisma.TransactionClient,
    userId: number,
    sessionId: number,
  ): Promise<ReviewSession | null> {
    const rows = await tx.$queryRaw<Array<{ id: number }>>(
      Prisma.sql`SELECT id FROM "ReviewSession" WHERE id = ${sessionId} AND "userId" = ${userId} FOR UPDATE`,
    );
    if (rows.length !== 1) return null;
    return tx.reviewSession.findUniqueOrThrow({ where: { id: sessionId } });
  }

  /** Runs one write transaction; never catches P2002 inside it (TL-160). */
  private async run<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<TxResult<T>>,
  ): Promise<T> {
    let result: TxResult<T>;
    try {
      result = await this.prisma.$transaction(callback);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      const kind = classifyLessonActivityPersistenceError(error);
      if (kind === 'unique_conflict' || kind === 'concurrent_retry') {
        throw new ConflictException(
          'Review update conflicted with a concurrent request; retry the request.',
        );
      }
      if (kind === 'timeout' || kind === 'connection_error') {
        throw new ServiceUnavailableException(
          'Review storage is unavailable; retry the request.',
        );
      }
      throw new InternalServerErrorException('Unable to update review.');
    }
    if ('fail' in result) throw result.fail;
    return result.value;
  }
}
