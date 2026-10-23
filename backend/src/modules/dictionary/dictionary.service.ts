import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { escapeLike, escapeRegex } from '../../common/utils/sql-pattern';
import { PrismaService } from '../../prisma/prisma.service';
import {
  assertIdempotencyKeyWithinTtl,
  parseIdempotencyKey,
} from '../learning/activity/lesson-activity-idempotency';
import { classifyLessonActivityPersistenceError } from '../learning/activity/lesson-activity-persistence';
import type {
  DictionaryWordDetailDto,
  DictionaryWordSavedDto,
  DictionaryWordSaveResultDto,
} from './dto/dictionary-word-response.dto';
import { classifyDictionaryQuery } from './dictionary-search-query';
import { toWordDetail, WORD_DETAIL_INCLUDE } from './dictionary-word.mapper';
import {
  MIN_PUBLIC_LEVEL_ORDER_SQL,
  PUBLIC_WORD_LEVELS,
  PUBLIC_WORD_SQL,
  PUBLIC_WORD_WHERE,
} from './public-word.policy';

const WORD_RESOURCE_TYPE = 'word';

const SEARCH_LIMIT = 20;

const SEARCH_WORD_INCLUDE = {
  meanings: { orderBy: { meaningOrder: 'asc' } },
  wordLevels: PUBLIC_WORD_LEVELS,
} as const satisfies Prisma.WordInclude;

/**
 * Group 2 of a Latin query: words not in `excludedIds` with a meaning column
 * that matches at a word start (A.5), exact matches first, then words with a
 * public Level, then the shortest matching meaning, then id.
 */
function meaningSearchSql(
  meaning: string,
  legacyMeaning: string | null,
  excludedIds: number[],
  limit: number,
): Prisma.Sql {
  const wordStart = (value: string) => `(^|[^[:alnum:]])${escapeRegex(value)}`;
  const contains = (value: string) => `%${escapeLike(value)}%`;
  const matches = (column: Prisma.Sql, value: string) =>
    Prisma.sql`(${column} LIKE ${contains(value)} AND ${column} ~ ${wordStart(value)})`;
  const vi = Prisma.sql`m."meaningViNormalized"`;
  const en = Prisma.sql`m."meaningEnNormalized"`;
  const exactValues = [meaning, `to ${meaning}`];

  const viMatch = matches(vi, meaning);
  const enMatch = matches(en, meaning);
  // shortcut: rows normalized by the P0 backfill keep their accents and only
  // match an accented query; backfill them with normalizeMeaning when M1.2a
  // imports Vietnamese meanings.
  const legacyMatch = legacyMeaning ? matches(vi, legacyMeaning) : null;
  const anyMatch = legacyMatch
    ? Prisma.sql`(${viMatch} OR ${enMatch} OR ${legacyMatch})`
    : Prisma.sql`(${viMatch} OR ${enMatch})`;
  const exact = legacyMatch
    ? Prisma.sql`(${vi} = ANY(${exactValues}) OR ${en} = ANY(${exactValues}) OR ${vi} = ${legacyMeaning})`
    : Prisma.sql`(${vi} = ANY(${exactValues}) OR ${en} = ANY(${exactValues}))`;
  const matchedLength = Prisma.sql`LEAST(
    CASE WHEN ${legacyMatch ? Prisma.sql`(${viMatch} OR ${legacyMatch})` : viMatch} THEN length(${vi}) END,
    CASE WHEN ${enMatch} THEN length(${en}) END)`;

  return Prisma.sql`
    WITH matched AS (
      SELECT m."wordId", bool_or(COALESCE(${exact}, false)) AS exact, min(${matchedLength}) AS len
      FROM "WordMeaning" m
      WHERE ${anyMatch}
      GROUP BY m."wordId"
    )
    SELECT w."id" FROM matched
    JOIN "Word" w ON w."id" = matched."wordId"
    WHERE ${PUBLIC_WORD_SQL} AND w."id" <> ALL(${excludedIds}::int[])
    ORDER BY matched.exact DESC, ${MIN_PUBLIC_LEVEL_ORDER_SQL} ASC NULLS LAST, matched.len, w."id"
    LIMIT ${limit}`;
}

const SAVE_EVENT_SELECT = {
  id: true,
  type: true,
  resourceType: true,
  resourceId: true,
  occurredAt: true,
  createdAt: true,
} as const;

function wordNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'WORD_NOT_FOUND',
    message: 'Word not found.',
  });
}

@Injectable()
export class DictionaryService {
  constructor(private prisma: PrismaService) {}

  async search(rawQuery: unknown) {
    const query = classifyDictionaryQuery(rawQuery);
    if (query.kind === 'invalid') return [];

    let ids: number[];
    if (query.kind === 'hanzi') {
      ids = await this.searchIds(Prisma.sql`
        SELECT w."id" FROM "Word" w
        WHERE ${PUBLIC_WORD_SQL}
          AND w."hanzi" LIKE ${`${escapeLike(query.prefix)}%`}
        ORDER BY ${MIN_PUBLIC_LEVEL_ORDER_SQL} ASC NULLS LAST, length(w."hanzi"), w."hanzi", w."id"
        LIMIT ${SEARCH_LIMIT}`);
    } else {
      // Group 1: pinyin prefix matches; group 2 fills the rest with words
      // matched only by a meaning (A.5).
      ids = query.pinyinPrefix
        ? await this.searchIds(Prisma.sql`
            SELECT w."id" FROM "Word" w
            WHERE ${PUBLIC_WORD_SQL}
              AND w."pinyinNormalized" LIKE ${`${escapeLike(query.pinyinPrefix)}%`}
            ORDER BY ${MIN_PUBLIC_LEVEL_ORDER_SQL} ASC NULLS LAST,
              (w."pinyinNormalized" = ${query.pinyinPrefix}) DESC,
              length(w."pinyinNormalized"), w."pinyinNormalized", w."id"
            LIMIT ${SEARCH_LIMIT}`)
        : [];
      if (query.meaning && ids.length < SEARCH_LIMIT) {
        ids = [
          ...ids,
          ...(await this.searchIds(
            meaningSearchSql(
              query.meaning,
              query.legacyMeaning,
              ids,
              SEARCH_LIMIT - ids.length,
            ),
          )),
        ];
      }
    }
    if (ids.length === 0) return [];

    const found = await this.prisma.word.findMany({
      where: { id: { in: ids } },
      include: SEARCH_WORD_INCLUDE,
    });
    const byId = new Map(found.map((word) => [word.id, word]));
    return ids.flatMap((id) => {
      const w = byId.get(id);
      if (!w) return [];
      return [
        {
          id: w.id,
          hanzi: w.hanzi,
          pinyin: w.pinyin,
          pinyinTone: w.pinyinTone,
          meanings: w.meanings.map((m) => ({
            en: m.meaningEn,
            vi: m.meaningVi ?? null,
          })),
          level: w.wordLevels[0]?.level?.name ?? null,
        },
      ];
    });
  }

  private async searchIds(sql: Prisma.Sql): Promise<number[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: number }>>(sql);
    return rows.map((row) => row.id);
  }

  async getWord(wordId: number): Promise<DictionaryWordDetailDto> {
    const word = await this.prisma.word.findFirst({
      where: { id: wordId, ...PUBLIC_WORD_WHERE },
      include: WORD_DETAIL_INCLUDE,
    });
    if (!word) throw wordNotFound();
    return toWordDetail(word);
  }

  /**
   * A saved word stays readable here after it stops being public, so the
   * learner can still unsave it (Q62).
   */
  async getSaved(
    userId: number,
    wordId: number,
  ): Promise<DictionaryWordSavedDto> {
    const saved = await this.prisma.userWord.findUnique({
      where: { userId_wordId: { userId, wordId } },
      select: { id: true },
    });
    if (saved) return { wordId, saved: true };
    await this.requirePublicWord(this.prisma, wordId);
    return { wordId, saved: false };
  }

  async saveWord(
    userId: number,
    wordId: number,
    rawKey: unknown,
  ): Promise<DictionaryWordSaveResultDto> {
    const idempotencyKey = parseIdempotencyKey(rawKey);
    return this.write(userId, async (tx) => {
      const replay = await tx.learningEvent.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
        select: SAVE_EVENT_SELECT,
      });
      if (replay) {
        assertIdempotencyKeyWithinTtl(replay.createdAt);
        if (
          replay.type !== 'word_saved' ||
          replay.resourceType !== WORD_RESOURCE_TYPE ||
          replay.resourceId !== wordId
        ) {
          throw new ConflictException(
            'Idempotency-Key was already used for a different request.',
          );
        }
        return this.saveResult(wordId, replay);
      }

      await this.requirePublicWord(tx, wordId);
      const existing = await tx.userWord.findUnique({
        where: { userId_wordId: { userId, wordId } },
        select: { id: true },
      });
      if (existing) return this.saveResult(wordId, null);

      const now = new Date();
      await tx.userWord.create({ data: { userId, wordId, createdAt: now } });
      const event = await tx.learningEvent.create({
        data: {
          userId,
          type: 'word_saved',
          resourceType: WORD_RESOURCE_TYPE,
          resourceId: wordId,
          idempotencyKey,
          occurredAt: now,
        },
        select: SAVE_EVENT_SELECT,
      });
      return this.saveResult(wordId, event);
    });
  }

  /** Unsaving writes no event: `LearningEventType` has no removal type. */
  async unsaveWord(
    userId: number,
    wordId: number,
  ): Promise<DictionaryWordSavedDto> {
    return this.write(userId, async (tx) => {
      await tx.userWord.deleteMany({ where: { userId, wordId } });
      return { wordId, saved: false };
    });
  }

  private async requirePublicWord(
    client: Prisma.TransactionClient,
    wordId: number,
  ): Promise<void> {
    const word = await client.word.findFirst({
      where: { id: wordId, ...PUBLIC_WORD_WHERE },
      select: { id: true },
    });
    if (!word) throw wordNotFound();
  }

  private saveResult(
    wordId: number,
    event: { id: bigint; occurredAt: Date } | null,
  ): DictionaryWordSaveResultDto {
    return {
      wordId,
      saved: true,
      eventId: event ? event.id.toString() : null,
      occurredAt: event ? event.occurredAt : null,
    };
  }

  /**
   * Same shape as the lesson-activity writes: the per-user row lock makes
   * concurrent saves of one learner run one after another, so the second
   * request sees the first one's UserWord instead of racing its insert.
   */
  private async write<T>(
    userId: number,
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const activeRows = await tx.$queryRaw<Array<{ id: number }>>(
          Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} AND status = 'active' AND "deletedAt" IS NULL FOR UPDATE`,
        );
        if (activeRows.length !== 1) {
          throw new UnauthorizedException('Account is not available.');
        }
        return callback(tx);
      });
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      const kind = classifyLessonActivityPersistenceError(error);
      if (kind === 'unique_conflict' || kind === 'concurrent_retry') {
        throw new ConflictException(
          'Saved word update conflicted with a concurrent request; retry the request.',
        );
      }
      if (kind === 'timeout' || kind === 'connection_error') {
        throw new ServiceUnavailableException(
          'Saved word storage is unavailable; retry the request.',
        );
      }
      throw new InternalServerErrorException('Unable to update saved word.');
    }
  }
}
