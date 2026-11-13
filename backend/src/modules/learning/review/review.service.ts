import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { ApiSuccessResponse } from '../../../common/interfaces/api-response.interface';
import {
  toWordDetail,
  WORD_DETAIL_INCLUDE,
} from '../../dictionary/dictionary-word.mapper';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ReviewOverviewResponseDto } from './dto/review-overview-response.dto';
import type {
  ReviewPreferencesResponseDto,
  UpdateReviewPreferencesDto,
} from './dto/review-preferences.dto';
import type { ReviewQueueResponseDto } from './dto/review-queue-response.dto';
import {
  addLocalDays,
  localDateOf,
  localMidnight,
  monthDates,
} from './review-calendar';
import {
  countGradedSince,
  dailyRemaining,
  dayStartOf,
  readReviewSettings,
  unknownLevelCodes,
} from './review-preferences';
import { buildReviewPreview } from './review-preview';
import { activeCardWhere, DUE_CARD_ORDER, dueCardWhere } from './review-queue';

const DAY_MS = 86_400_000;
const RECENT_SESSION_LIMIT = 5;

@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Read only: one `now` for the filter and every preview. Q281 keeps the
   * chosen levels; Q282 cuts `items` (not `dueCount`) at the daily limit.
   */
  async getQueue(
    userId: number,
    limit: number,
    now: Date,
  ): Promise<ApiSuccessResponse<ReviewQueueResponseDto>> {
    const settings = await readReviewSettings(this.prisma, userId);
    const remaining = dailyRemaining(
      settings.dailyCardLimit,
      await countGradedSince(
        this.prisma,
        userId,
        dayStartOf(now, settings.timezone),
      ),
    );
    const where = dueCardWhere(userId, now, settings.levelCodes);
    const [dueCount, cards] = await this.prisma.$transaction(
      [
        this.prisma.reviewCard.count({ where }),
        this.prisma.reviewCard.findMany({
          where,
          orderBy: [...DUE_CARD_ORDER],
          take: Math.min(limit, remaining),
          include: { word: { include: WORD_DETAIL_INCLUDE } },
        }),
        // One snapshot, so `dueCount` agrees with `items` under concurrent saves.
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      success: true,
      data: {
        dueCount,
        dailyLimitReached: remaining === 0,
        items: cards.map((card) => ({
          cardId: card.id,
          state: card.state,
          dueAt: card.dueAt,
          word: toWordDetail(card.word),
          preview: buildReviewPreview(card, now),
        })),
      },
    };
  }

  /**
   * M3.3b (Q268), read only. Day windows use the learner's timezone (the
   * `UserProfile.timezone` Home also uses), else `Asia/Ho_Chi_Minh`.
   */
  async getOverview(
    userId: number,
    now: Date,
  ): Promise<ApiSuccessResponse<ReviewOverviewResponseDto>> {
    const settings = await readReviewSettings(this.prisma, userId);
    const tz = settings.timezone;

    const today = localDateOf(now, tz);
    const dayStart = (offset: number) =>
      localMidnight(addLocalDays(today, offset), tz);
    const tomorrow = dayStart(1);
    const month = monthDates(today);
    const monthStart = localMidnight(month[0], tz);
    const monthEnd = localMidnight(
      addLocalDays(month[month.length - 1], 1),
      tz,
    );
    const active = activeCardWhere(userId, settings.levelCodes);
    const upcoming = (days: number) =>
      this.prisma.reviewCard.count({
        where: { ...active, dueAt: { gte: tomorrow, lt: dayStart(1 + days) } },
      });
    const ownEvents = { card: { userId } };

    const [dueToday, days3, days7, days14, week, monthEvents, sessions] =
      await this.prisma.$transaction(
        [
          this.prisma.reviewCard.count({
            where: { ...active, dueAt: { lt: tomorrow } },
          }),
          upcoming(3),
          upcoming(7),
          upcoming(14),
          this.prisma.reviewEvent.groupBy({
            by: ['grade'],
            where: {
              ...ownEvents,
              reviewedAt: {
                gt: new Date(now.getTime() - 7 * DAY_MS),
                lte: now,
              },
            },
            _count: { _all: true },
          }),
          this.prisma.reviewEvent.findMany({
            where: {
              ...ownEvents,
              reviewedAt: { gte: monthStart, lt: monthEnd },
            },
            select: { reviewedAt: true },
          }),
          this.prisma.reviewSession.findMany({
            where: {
              userId,
              status: 'completed',
              completedAt: { gte: new Date(now.getTime() - 30 * DAY_MS) },
            },
            orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
            take: RECENT_SESSION_LIMIT,
            select: {
              id: true,
              completedAt: true,
              reviewedCount: true,
              summary: true,
            },
          }),
        ],
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );

    let total = 0;
    let forgot = 0;
    for (const row of week) {
      total += row._count._all;
      if (row.grade === 'again') forgot += row._count._all;
    }
    const perDay = new Map<string, number>();
    for (const event of monthEvents) {
      const date = localDateOf(event.reviewedAt, tz);
      perDay.set(date, (perDay.get(date) ?? 0) + 1);
    }

    return {
      success: true,
      data: {
        timezone: tz,
        dueToday,
        upcoming: { days3, days7, days14 },
        retention7d:
          total === 0 ? null : Math.round(((total - forgot) / total) * 100),
        calendar: month.map((date) => ({
          date,
          reviewed: perDay.get(date) ?? 0,
        })),
        recentSessions: sessions.map((session) => ({
          sessionId: session.id,
          completedAt: session.completedAt ?? now,
          reviewedCount: session.reviewedCount,
          retentionPercent: retentionOf(session.summary),
        })),
      },
    };
  }

  /** M3.3c (Q280): saved settings or the defaults; never writes a row. */
  async getPreferences(
    userId: number,
  ): Promise<ApiSuccessResponse<ReviewPreferencesResponseDto>> {
    const [settings, levels] = await Promise.all([
      readReviewSettings(this.prisma, userId),
      this.publicLevels(),
    ]);
    return {
      success: true,
      data: {
        dailyCardLimit: settings.dailyCardLimit,
        // Codes of a level unpublished since saving drop out of the panel.
        levelCodes: settings.levelCodes,
        levels,
      },
    };
  }

  /** Q280: upsert; every code must be a published, not deleted Level. */
  async updatePreferences(
    userId: number,
    body: UpdateReviewPreferencesDto,
  ): Promise<ApiSuccessResponse<ReviewPreferencesResponseDto>> {
    const levels = await this.publicLevels();
    const unknown = unknownLevelCodes(
      body.levelCodes,
      levels.map((level) => level.code),
    );
    if (unknown.length > 0) {
      throw new BadRequestException('levelCodes contains an unknown level.');
    }
    const saved = await this.prisma.reviewPreference.upsert({
      where: { userId },
      create: {
        userId,
        dailyCardLimit: body.dailyCardLimit,
        levelCodes: body.levelCodes,
      },
      update: {
        dailyCardLimit: body.dailyCardLimit,
        levelCodes: body.levelCodes,
      },
      select: { dailyCardLimit: true, levelCodes: true },
    });
    return { success: true, data: { ...saved, levels } };
  }

  private publicLevels(): Promise<{ code: string; name: string }[]> {
    return this.prisma.level.findMany({
      where: { status: 'published', deletedAt: null },
      orderBy: { orderIndex: 'asc' },
      select: { code: true, name: true },
    });
  }
}

/** `summary.retentionPercent` written on complete (Q254), else null. */
function retentionOf(summary: Prisma.JsonValue): number | null {
  if (
    summary === null ||
    typeof summary !== 'object' ||
    Array.isArray(summary)
  ) {
    return null;
  }
  const value = summary.retentionPercent;
  return typeof value === 'number' ? value : null;
}
