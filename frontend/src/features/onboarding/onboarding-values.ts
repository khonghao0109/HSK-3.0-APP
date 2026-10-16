// Runtime values used by 'use client' onboarding components. This module must
// not import zod (directly or transitively): Zod 4 probes Function("") on init,
// which violates the CSP without 'unsafe-eval'. Guard: src/client-bundle-guard.spec.ts.

import type { LevelItem } from './onboarding-contract';

export const LEARNING_PURPOSES = [
  'communication',
  'study_abroad',
  'hsk_exam',
  'work',
] as const;
export type LearningPurpose = (typeof LEARNING_PURPOSES)[number];

function isLearningPurpose(value: unknown): value is LearningPurpose {
  return (
    typeof value === 'string' &&
    (LEARNING_PURPOSES as readonly string[]).includes(value)
  );
}

export function parseGoalPageSearchParams(
  params: Record<string, string | string[] | undefined>,
): {
  purpose?: LearningPurpose;
  band?: number;
  notice?: 'content_unavailable';
} {
  const rawPurpose = Array.isArray(params.purpose)
    ? params.purpose[0]
    : params.purpose;
  const rawBand = Array.isArray(params.band) ? params.band[0] : params.band;
  const rawNotice = Array.isArray(params.notice)
    ? params.notice[0]
    : params.notice;

  const bandNum = rawBand !== undefined ? Number(rawBand) : NaN;
  const isBandValid = Number.isInteger(bandNum) && bandNum >= 1 && bandNum <= 9;

  return {
    purpose: isLearningPurpose(rawPurpose) ? rawPurpose : undefined,
    band: isBandValid ? bandNum : undefined,
    notice:
      rawNotice === 'content_unavailable' ? 'content_unavailable' : undefined,
  };
}

export function resolveLevelForBand(
  levels: LevelItem[],
  band: number,
): LevelItem | null {
  return levels.find((l) => l.minBand <= band && band <= l.maxBand) ?? null;
}

export function availableBands(
  levels: Array<{ minBand: number; maxBand: number }>,
): number[] {
  const bands = new Set<number>();
  for (const level of levels) {
    for (let b = level.minBand; b <= level.maxBand; b++) {
      if (b >= 1 && b <= 9) {
        bands.add(b);
      }
    }
  }
  return Array.from(bands).sort((a, b) => a - b);
}

export function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
