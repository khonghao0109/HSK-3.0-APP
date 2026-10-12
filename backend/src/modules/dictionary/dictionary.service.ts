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

import { normalizePinyin } from '../../common/utils/normalize-pinyin';
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
import { toWordDetail, WORD_DETAIL_INCLUDE } from './dictionary-word.mapper';
import { PUBLIC_WORD_LEVELS, PUBLIC_WORD_WHERE } from './public-word.policy';

const WORD_RESOURCE_TYPE = 'word';

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

  async search(query: string) {
    if (!query) return [];
    const displayQuery = query.trim();
    if (!displayQuery) return [];

    const isValid = /^[a-zA-Z1-5:\u00fc\u00dc\u3400-\u9fff' ]+$/.test(
      displayQuery,
    );
    if (!isValid) return [];

    const isHanziQuery = /[\u3400-\u9fff]/.test(displayQuery);

    const words = await this.prisma.word.findMany({
      where: {
        ...PUBLIC_WORD_WHERE,
        ...(isHanziQuery
          ? { hanzi: { startsWith: displayQuery } }
          : {
              pinyinNormalized: {
                startsWith: normalizePinyin(displayQuery),
              },
            }),
      },
      take: 20,
      include: {
        meanings: {
          orderBy: { meaningOrder: 'asc' },
        },
        wordLevels: PUBLIC_WORD_LEVELS,
      },
    });

    return words.map((w) => ({
      id: w.id,
      hanzi: w.hanzi,
      pinyin: w.pinyin,
      pinyinTone: w.pinyinTone,
      meanings: w.meanings.map((m) => ({
        en: m.meaningEn,
        vi: m.meaningVi ?? null,
      })),
      level: w.wordLevels[0]?.level?.name ?? null,
    }));
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
