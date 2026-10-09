import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { ApiSuccessResponse } from '../../../common/interfaces/api-response.interface';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  DEFAULT_USER_PROFILE,
  validateDisplayName,
  validateTimezone,
} from '../../user/validation/user-profile.validator';
import { selectNextLesson } from '../path/learning-path.policy';
import { LearningPathService } from '../path/learning-path.service';
import { LearningHomeResponseDto } from './dto/learning-home-response.dto';
import { countStreak, type LearningDayRun } from './learning-home.policy';

@Injectable()
export class LearningHomeService {
  private readonly logger = new Logger(LearningHomeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly path: LearningPathService,
  ) {}

  /** Q13 Home summary, read-only. `now` is the only clock used. */
  async getHome(
    userId: number,
    now: Date,
  ): Promise<ApiSuccessResponse<LearningHomeResponseDto>> {
    const [{ nextStep, goal, pathLevels }, user] = await Promise.all([
      this.path.loadPathState(userId),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          profile: { select: { displayName: true, timezone: true } },
        },
      }),
    ]);

    const timezone = validateTimezone(user?.profile?.timezone);
    const tz = timezone.valid
      ? timezone.normalized
      : DEFAULT_USER_PROFILE.timezone;
    let today: { todayLocal: string; minutesToday: number };
    let run: LearningDayRun | null;
    try {
      [today, run] = await this.loadDay(userId, now, tz);
    } catch (error) {
      if (!isUnknownZoneInPostgres(error, tz)) throw error;
      this.logger.warn(
        `PostgreSQL rejected timezone, using ${DEFAULT_USER_PROFILE.timezone} (userId=${userId}, tz=${tz})`,
      );
      [today, run] = await this.loadDay(
        userId,
        now,
        DEFAULT_USER_PROFILE.timezone,
      );
    }

    const next = selectNextLesson({
      levels: pathLevels,
      targetLevelOrderIndex: goal?.targetLevel.orderIndex ?? null,
    });
    const continued = next
      ? pathLevels
          .find((level) => level.code === next.levelCode)
          ?.lessons.find((lesson) => lesson.id === next.lessonId)
      : undefined;

    return {
      success: true,
      data: {
        nextStep,
        greetingName: greetingNameOf(user),
        dailyGoal: goal
          ? {
              targetMinutes: goal.dailyMinutes,
              minutesToday: today.minutesToday,
            }
          : null,
        streakDays: countStreak(run, today.todayLocal),
        continueLesson:
          next && continued
            ? { ...next, completionPercent: continued.completionPercent }
            : null,
      },
    };
  }

  /** Both day queries for one timezone, run in parallel. */
  private loadDay(userId: number, now: Date, tz: string) {
    return Promise.all([
      this.loadToday(userId, now, tz),
      this.loadLatestRun(userId, now, tz),
    ]);
  }

  /**
   * Local calendar day in `tz` and the learner's submitted exercise minutes
   * from its start up to `now`, capped at one day. The start is local
   * midnight converted by the zone rules, so a DST day keeps its real length.
   */
  private async loadToday(
    userId: number,
    now: Date,
    tz: string,
  ): Promise<{ todayLocal: string; minutesToday: number }> {
    const [row] = await this.prisma.$queryRaw<
      Array<{ todayLocal: string; minutesToday: number }>
    >`
      WITH bounds AS (
        SELECT (${now.toISOString()}::timestamptz AT TIME ZONE ${tz}::text)::date AS today
      )
      SELECT
        bounds.today::text AS "todayLocal",
        LEAST(COALESCE(SUM(attempt."durationSeconds"), 0) / 60, 1440)::int AS "minutesToday"
      FROM bounds
      LEFT JOIN "LessonExerciseAttempt" attempt
        ON attempt."userId" = ${userId}
        AND attempt."durationSeconds" IS NOT NULL
        AND attempt."submittedAt" >= ((bounds.today::timestamp AT TIME ZONE ${tz}::text) AT TIME ZONE 'UTC')
        AND attempt."submittedAt" <= (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      GROUP BY bounds.today
    `;
    return row;
  }

  /**
   * Gaps-and-islands over local learning days (a completed lesson or topic,
   * or a submitted exercise, up to `now`): the most recent run only.
   */
  private async loadLatestRun(
    userId: number,
    now: Date,
    tz: string,
  ): Promise<LearningDayRun | null> {
    const [row] = await this.prisma.$queryRaw<LearningDayRun[]>`
      WITH days AS (
        SELECT DISTINCT ((event."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}::text)::date AS day
        FROM "LearningEvent" event
        WHERE event."userId" = ${userId}
          AND event.type IN ('lesson_completed', 'topic_completed', 'exercise_submitted')
          AND event."occurredAt" <= (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      ),
      islands AS (
        SELECT day, day - (ROW_NUMBER() OVER (ORDER BY day))::int AS island
        FROM days
      )
      SELECT MAX(day)::text AS "lastDay", COUNT(*)::int AS "runLength"
      FROM islands
      GROUP BY island
      ORDER BY MAX(day) DESC
      LIMIT 1
    `;
    return row ?? null;
  }
}

/**
 * A zone Node ICU accepts (so `validateTimezone` passed) but PostgreSQL does
 * not know: the raw query fails with SQLSTATE 22023. The default zone is
 * never retried.
 */
function isUnknownZoneInPostgres(error: unknown, tz: string): boolean {
  return (
    tz !== DEFAULT_USER_PROFILE.timezone &&
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2010' &&
    error.meta?.code === '22023'
  );
}

/** Trimmed `displayName`, else a valid account `name`, else null ("Chào bạn"). */
function greetingNameOf(
  user: {
    name: string | null;
    profile: { displayName: string | null } | null;
  } | null,
): string | null {
  const displayName = user?.profile?.displayName?.trim();
  if (displayName) return displayName;
  const name = validateDisplayName(user?.name ?? null);
  return name.valid ? name.normalized : null;
}
