import { Injectable } from '@nestjs/common';
import { normalizePinyin } from '../../common/utils/normalize-pinyin';
import { PrismaService } from '../../prisma/prisma.service';

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
    const publicVisibility = {
      status: 'published' as const,
      deletedAt: null,
      isPure: true,
    };

    const words = await this.prisma.word.findMany({
      where: {
        ...publicVisibility,
        ...(isHanziQuery
          ? { hanzi: { startsWith: displayQuery } }
          : {
              pinyinNormalized: {
                startsWith: normalizePinyin(displayQuery),
              },
            }),
        meanings: { some: {} },
      },
      take: 20,
      include: {
        meanings: {
          orderBy: { meaningOrder: 'asc' },
        },
        wordLevels: {
          where: {
            level: {
              status: 'published',
              deletedAt: null,
            },
          },
          include: { level: true },
          orderBy: { level: { orderIndex: 'asc' } },
        },
      },
    });

    return words.map((w) => ({
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
}
