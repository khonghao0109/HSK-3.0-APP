import type { Prisma } from '@prisma/client';

import type { DictionaryWordDetailDto } from './dto/dictionary-word-response.dto';
import { PUBLIC_WORD_LEVELS } from './public-word.policy';

export const WORD_DETAIL_INCLUDE = {
  meanings: { orderBy: { meaningOrder: 'asc' } },
  wordLevels: PUBLIC_WORD_LEVELS,
  sources: {
    include: { dataSource: true },
    orderBy: [{ isPrimary: 'desc' }, { dataSourceId: 'asc' }],
  },
} as const satisfies Prisma.WordInclude;

export type WordDetailRecord = Prisma.WordGetPayload<{
  include: typeof WORD_DETAIL_INCLUDE;
}>;

/** Builds the public detail; the query already filtered and ordered rows. */
export function toWordDetail(word: WordDetailRecord): DictionaryWordDetailDto {
  return {
    id: word.id,
    hanzi: word.hanzi,
    traditional: word.traditional,
    pinyin: word.pinyin,
    pinyinTone: word.pinyinTone,
    example: word.example,
    meanings: word.meanings.map((meaning) => ({
      order: meaning.meaningOrder,
      en: meaning.meaningEn,
      vi: meaning.meaningVi,
      partOfSpeech: meaning.partOfSpeech,
      usage: meaning.usage,
      note: meaning.note,
    })),
    levels: word.wordLevels.map(({ level }) => ({
      code: level.code,
      name: level.name,
    })),
    sources: word.sources.map(({ dataSource }) => ({
      name: dataSource.name,
      version: dataSource.version,
      license: dataSource.license,
      attribution: dataSource.attribution,
    })),
  };
}
