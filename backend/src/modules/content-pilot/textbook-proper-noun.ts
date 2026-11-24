import type { PrismaClient } from '@prisma/client';

import { normalizePinyin } from '../../common/utils/normalize-pinyin';
import {
  TEXTBOOK_DATA_SOURCE,
  type TextbookWord,
} from './textbook-seeddata.converter';

/**
 * M2.13b FIX-3 (PO 24/11/2026): with `--publish`, a draft Word that the
 * textbook importer created for a seeddata "Danh từ riêng" is published, one
 * row lock + one AuditLog per Word. Nothing else is ever auto-approved.
 */
export const PROPER_NOUN_POS = 'Danh từ riêng';
export const PROPER_NOUN_AUDIT_ACTION = 'word.auto_published_proper_noun';

export interface ProperNounCandidate {
  readonly publish: boolean;
  /** Seeddata part of speech of the lesson word. */
  readonly partOfSpeech: string | null;
  readonly status: string;
  readonly deletedAt: Date | null;
  /** Codes of every WordSource of the Word. */
  readonly sourceCodes: readonly string[];
}

function isTextbookProperNounDraft(
  word: Omit<ProperNounCandidate, 'publish'>,
): boolean {
  return (
    word.partOfSpeech?.trim() === PROPER_NOUN_POS &&
    word.status === 'draft' &&
    word.deletedAt === null &&
    word.sourceCodes.length > 0 &&
    // A dictionary Word, even one the textbook also cites, is never touched.
    word.sourceCodes.every((code) => code === TEXTBOOK_DATA_SOURCE.code)
  );
}

export function shouldAutoPublishProperNoun(
  candidate: ProperNounCandidate,
): boolean {
  return candidate.publish && isTextbookProperNounDraft(candidate);
}

const wordKey = (hanzi: string, pinyin: string): string =>
  `${hanzi}\u0000${normalizePinyin(pinyin)}`;

function properNounPos(
  words: readonly TextbookWord[],
): Map<string, string | null> {
  return new Map(
    words
      .filter((word) => word.partOfSpeech?.trim() === PROPER_NOUN_POS)
      .map((word) => [wordKey(word.hanzi, word.pinyin), word.partOfSpeech]),
  );
}

/**
 * Dry-run report: proper nouns of the file a `--publish` run would approve.
 * Mirrors `resolveTextbookWords`: a hanzi with no row becomes a new textbook
 * draft; otherwise only an existing draft textbook-only Word counts (a
 * dictionary Word never does). Reads only.
 */
export async function countProperNounCandidates(
  prisma: PrismaClient,
  words: readonly TextbookWord[],
): Promise<number> {
  let count = 0;
  for (const [key, partOfSpeech] of properNounPos(words)) {
    const [hanzi] = key.split('\u0000');
    const rows = await prisma.word.findMany({
      where: { hanzi },
      select: {
        status: true,
        deletedAt: true,
        sources: { select: { dataSource: { select: { code: true } } } },
      },
    });
    if (
      rows.length === 0 ||
      rows.some((row) =>
        isTextbookProperNounDraft({
          partOfSpeech,
          status: row.status,
          deletedAt: row.deletedAt,
          sourceCodes: row.sources.map((source) => source.dataSource.code),
        }),
      )
    ) {
      count += 1;
    }
  }
  return count;
}

/**
 * Publishes the lesson's draft textbook proper nouns, one transaction per
 * Word: `SELECT … FOR UPDATE`, re-check, update, audit. Returns the count.
 */
export async function autoPublishProperNouns(
  prisma: PrismaClient,
  input: {
    readonly lessonId: number;
    readonly words: readonly TextbookWord[];
    readonly actorId: number;
    readonly publish: boolean;
  },
): Promise<number> {
  if (!input.publish) return 0;
  const proper = properNounPos(input.words);
  if (proper.size === 0) return 0;
  const lessonWords = await prisma.lessonWord.findMany({
    where: { lessonId: input.lessonId, word: { status: 'draft' } },
    orderBy: { wordId: 'asc' },
    select: { word: { select: { id: true, hanzi: true, pinyin: true } } },
  });
  let published = 0;
  for (const { word } of lessonWords) {
    const key = wordKey(word.hanzi, word.pinyin);
    if (!proper.has(key)) continue;
    const done = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ status: string; deletedAt: Date | null }>
      >`SELECT "status"::text AS "status", "deletedAt" FROM "Word" WHERE "id" = ${word.id} FOR UPDATE`;
      const sources = await tx.wordSource.findMany({
        where: { wordId: word.id },
        select: { dataSource: { select: { code: true } } },
      });
      const row = locked[0];
      if (
        row === undefined ||
        !shouldAutoPublishProperNoun({
          publish: input.publish,
          partOfSpeech: proper.get(key) ?? null,
          status: row.status,
          deletedAt: row.deletedAt,
          sourceCodes: sources.map((source) => source.dataSource.code),
        })
      ) {
        return false;
      }
      await tx.word.update({
        where: { id: word.id },
        data: {
          status: 'published',
          publishedAt: new Date(),
          publishedById: input.actorId,
          updatedById: input.actorId,
        },
        select: { id: true },
      });
      // Ids and codes only: no hanzi, meaning or user data.
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: PROPER_NOUN_AUDIT_ACTION,
          targetType: 'word',
          targetId: String(word.id),
          beforeSummary: { status: 'draft' },
          afterSummary: {
            wordId: word.id,
            status: 'published',
            dataSource: TEXTBOOK_DATA_SOURCE.code,
          },
        },
        select: { id: true },
      });
      return true;
    });
    if (done) published += 1;
  }
  return published;
}
