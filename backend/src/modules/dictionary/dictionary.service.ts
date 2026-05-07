import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DictionaryService {
  constructor(private prisma: PrismaService) {}

  async search(query: string) {
    if (!query) return [];
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

    // FIX 1: Cho phép khoảng trắng để search multi-word pinyin như "ni hao", "xue xi"
    const isValid = /^[a-zA-Z\u4e00-\u9fa5 ]+$/.test(normalizedQuery);
    if (!isValid) return [];

    const words = await this.prisma.word.findMany({
      where: {
        AND: [
          {
            OR: [
              { hanzi: { startsWith: normalizedQuery } },
              { pinyin: { startsWith: normalizedQuery.toLowerCase() } },
            ],
          },
          { isPure: true },
          { meanings: { some: {} } },
        ],
      },
      take: 20,
      include: {
        meanings: true,
        wordLevels: {
          include: { level: true },
          // FIX 2: Sort theo orderIndex để lấy đúng level thấp nhất của từ
          orderBy: { level: { orderIndex: 'asc' } },
        },
      },
    });

    return words.map((w) => ({
      hanzi: w.hanzi,
      pinyin: w.pinyin,
      pinyinTone: w.pinyinTone,
      // FIX 3: Trả về tất cả meanings (EN + VI) thay vì chỉ EN
      meanings: w.meanings.map((m) => ({
        en: m.meaningEn,
        vi: m.meaningVi ?? null,
      })),
      // Sau khi sort theo orderIndex, [0] luôn là level thấp nhất (chính xác nhất)
      level: w.wordLevels[0]?.level?.name ?? null,
    }));
  }
}
