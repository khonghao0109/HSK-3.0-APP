import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Injectable()
export class DictionaryService {
  async search(query: string) {
    if (!query) return [];
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

    const isValid = /^[a-zA-Z\u4e00-\u9fa5]+$/.test(normalizedQuery);
    if (!isValid) return [];

    const words = await prisma.word.findMany({
      where: {
        AND: [
          {
            OR: [
              { hanzi: { startsWith: normalizedQuery } },
              { pinyin: { startsWith: normalizedQuery.toLowerCase() } },
            ],
          },
          {
            isPure: true,
          },
          {
            meanings: { some: {} },
          },
        ],
      },
      take: 20,
      include: {
        meanings: true,
        wordLevels: {
          include: {
            level: true,
          },
        },
      },
    });

    return words.map((w) => ({
      hanzi: w.hanzi,
      pinyin: w.pinyin,
      pinyinTone: w.pinyinTone,
      meanings: w.meanings.map((m) => m.meaningEn),
      level: w.wordLevels[0]?.level?.name || null,
    }));
  }
}
