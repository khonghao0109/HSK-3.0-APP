import type { Prisma } from '@prisma/client';

import {
  DEFAULT_USER_PROFILE,
  validateTimezone,
} from '../../user/validation/user-profile.validator';
import { localDateOf, localMidnight } from './review-calendar';

/** M3.3c (Q279): the three choices of "Số thẻ mỗi ngày". */
export const DAILY_CARD_LIMITS = [10, 20, 30] as const;

/** What a learner without a `ReviewPreference` row gets; GET never writes it. */
export const DEFAULT_REVIEW_PREFERENCES = {
  dailyCardLimit: 20,
  levelCodes: [] as string[],
};

/** Requested codes that are not public levels, in request order. */
export function unknownLevelCodes(
  requested: readonly string[],
  publicCodes: readonly string[],
): string[] {
  const known = new Set(publicCodes);
  return requested.filter((code) => !known.has(code));
}

/**
 * Q281: the saved codes that are still public levels. A level unpublished
 * after saving drops out, and none left means every level, so the queue
 * never goes silently empty.
 */
export function activeLevelCodes(
  saved: readonly string[],
  publicCodes: readonly string[],
): string[] {
  const known = new Set(publicCodes);
  return saved.filter((code) => known.has(code));
}

/** Q282: cards left today; never below 0. */
export function dailyRemaining(limit: number, gradedToday: number): number {
  return Math.max(0, limit - gradedToday);
}

/** Q282: 00:00 of the learner's local day that contains `now`. */
export function dayStartOf(now: Date, tz: string): Date {
  return localMidnight(localDateOf(now, tz), tz);
}

/** Q281: cards of a word in one of `codes` (public levels); empty = every level. */
export function levelCardWhere(
  codes: readonly string[],
): Prisma.ReviewCardWhereInput {
  if (codes.length === 0) return {};
  return {
    word: {
      wordLevels: {
        some: {
          level: {
            code: { in: [...codes] },
            status: 'published',
            deletedAt: null,
          },
        },
      },
    },
  };
}

type SettingsReader = Pick<
  Prisma.TransactionClient,
  'userProfile' | 'reviewPreference' | 'reviewEvent' | 'level'
>;

export interface ReviewSettings {
  dailyCardLimit: number;
  /** Q281: the saved codes still public; what queries filter by. */
  levelCodes: string[];
  /** `UserProfile.timezone`, else `Asia/Ho_Chi_Minh` (Q276, Q282). */
  timezone: string;
}

/** The learner's review settings and timezone; read only. */
export async function readReviewSettings(
  db: SettingsReader,
  userId: number,
): Promise<ReviewSettings> {
  const [profile, preference] = await Promise.all([
    db.userProfile.findUnique({
      where: { userId },
      select: { timezone: true },
    }),
    db.reviewPreference.findUnique({
      where: { userId },
      select: { dailyCardLimit: true, levelCodes: true },
    }),
  ]);
  const zone = validateTimezone(profile?.timezone);
  const saved = preference?.levelCodes ?? DEFAULT_REVIEW_PREFERENCES.levelCodes;
  const publicCodes =
    saved.length === 0
      ? []
      : (
          await db.level.findMany({
            where: {
              code: { in: saved },
              status: 'published',
              deletedAt: null,
            },
            select: { code: true },
          })
        ).map((level) => level.code);
  return {
    dailyCardLimit:
      preference?.dailyCardLimit ?? DEFAULT_REVIEW_PREFERENCES.dailyCardLimit,
    levelCodes: activeLevelCodes(saved, publicCodes),
    timezone: zone.valid ? zone.normalized : DEFAULT_USER_PROFILE.timezone,
  };
}

/** Q282: distinct cards of the learner graded since `since`, any session. */
export async function countGradedSince(
  db: SettingsReader,
  userId: number,
  since: Date,
): Promise<number> {
  const rows = await db.reviewEvent.findMany({
    where: { card: { userId }, reviewedAt: { gte: since } },
    distinct: ['cardId'],
    select: { cardId: true },
  });
  return rows.length;
}
