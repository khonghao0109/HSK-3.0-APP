import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { ApiSuccessResponse } from '../../../common/interfaces/api-response.interface';
import {
  toWordDetail,
  WORD_DETAIL_INCLUDE,
} from '../../dictionary/dictionary-word.mapper';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ReviewQueueResponseDto } from './dto/review-queue-response.dto';
import { buildReviewPreview } from './review-preview';
import { DUE_CARD_ORDER, dueCardWhere } from './review-queue';

@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  /** Read only: one `now` for the filter and every preview. */
  async getQueue(
    userId: number,
    limit: number,
    now: Date,
  ): Promise<ApiSuccessResponse<ReviewQueueResponseDto>> {
    const where = dueCardWhere(userId, now);
    const [dueCount, cards] = await this.prisma.$transaction(
      [
        this.prisma.reviewCard.count({ where }),
        this.prisma.reviewCard.findMany({
          where,
          orderBy: [...DUE_CARD_ORDER],
          take: limit,
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
}
