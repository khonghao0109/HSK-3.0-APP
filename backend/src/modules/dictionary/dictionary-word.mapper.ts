import type { DataSource, Prisma } from '@prisma/client';

import type {
  DictionaryRelatedWordDto,
  DictionaryWordDetailDto,
  DictionaryWordFullDetailDto,
  DictionaryWordSourceDto,
} from './dto/dictionary-word-response.dto';
import {
  projectPublicWordAudio,
  PUBLIC_WORD_AUDIO_SELECT,
  PUBLIC_WORD_LEVELS,
} from './public-word.policy';

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

function toSource(dataSource: DataSource): DictionaryWordSourceDto {
  return {
    name: dataSource.name,
    version: dataSource.version,
    license: dataSource.license,
    attribution: dataSource.attribution,
  };
}

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
    sources: word.sources.map(({ dataSource }) => toSource(dataSource)),
  };
}

/** `getWord` only: review keeps `WORD_DETAIL_INCLUDE` byte for byte (Q306). */
export const WORD_FULL_INCLUDE = {
  ...WORD_DETAIL_INCLUDE,
  audio: { select: PUBLIC_WORD_AUDIO_SELECT },
  examples: {
    where: {
      status: 'published',
      deletedAt: null,
      dataSourceId: { not: null },
    },
    include: { dataSource: true },
    orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }],
  },
} as const satisfies Prisma.WordInclude;

export type WordFullRecord = Prisma.WordGetPayload<{
  include: typeof WORD_FULL_INCLUDE;
}>;

export function toWordFullDetail(
  word: WordFullRecord,
  related: DictionaryRelatedWordDto[],
): DictionaryWordFullDetailDto {
  return {
    ...toWordDetail(word),
    audio: projectPublicWordAudio(word.audio),
    examples: word.examples.flatMap(({ dataSource, ...example }) =>
      dataSource
        ? [
            {
              hanzi: example.hanzi,
              pinyin: example.pinyin,
              vi: example.translationVi,
              en: example.translationEn,
              source: toSource(dataSource),
              audio: null,
            },
          ]
        : [],
    ),
    related,
  };
}
