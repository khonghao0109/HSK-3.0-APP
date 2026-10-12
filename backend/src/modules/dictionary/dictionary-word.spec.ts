import {
  DictionaryController,
  dictionaryReadLimit,
  wordSaveLimit,
} from './dictionary.controller';
import {
  toWordDetail,
  WORD_DETAIL_INCLUDE,
  type WordDetailRecord,
} from './dictionary-word.mapper';
import { PUBLIC_WORD_LEVELS, PUBLIC_WORD_WHERE } from './public-word.policy';

function withNodeEnv(nodeEnv: string, run: () => void): void {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;
  try {
    run();
  } finally {
    process.env.NODE_ENV = previous;
  }
}

const now = new Date('2026-10-12T00:00:00Z');

function wordRecord(): WordDetailRecord {
  const meaning = (order: number, en: string, vi: string | null) => ({
    id: order,
    wordId: 12,
    meaningOrder: order,
    meaningEn: en,
    meaningVi: vi,
    meaningEnNormalized: en,
    meaningViNormalized: vi,
    partOfSpeech: order === 1 ? 'verb' : null,
    usage: null,
    note: null,
    dataSourceId: null,
    createdAt: now,
    updatedAt: now,
  });
  const source = (id: number, isPrimary: boolean, license: string | null) => ({
    id,
    wordId: 12,
    dataSourceId: id,
    sourceKey: null,
    isPrimary,
    createdAt: now,
    dataSource: {
      id,
      code: `src-${id}`,
      name: `Source ${id}`,
      version: '1.0.0',
      referenceUrl: 'https://example.invalid/private',
      license,
      attribution: null,
      receivedAt: null,
      importedAt: null,
      contentHash: null,
      notes: null,
      createdById: 7,
      createdAt: now,
      updatedAt: now,
    },
  });
  return {
    id: 12,
    hanzi: '学习',
    traditional: '學習',
    pinyin: 'xué xí',
    pinyinNormalized: 'xuexi',
    pinyinTone: 'xue2 xi2',
    example: null,
    isPure: true,
    audioId: 3,
    imageId: 4,
    strokeAnimationId: 5,
    status: 'published',
    createdById: 7,
    updatedById: 7,
    publishedById: 7,
    publishedAt: now,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    meanings: [meaning(1, 'to study', 'học tập'), meaning(2, 'to learn', null)],
    wordLevels: [
      {
        id: 1,
        wordId: 12,
        levelId: 1,
        dataSourceId: null,
        level: {
          id: 1,
          code: 'HSK1',
          name: 'HSK 1',
        } as WordDetailRecord['wordLevels'][number]['level'],
      },
    ],
    sources: [source(9, true, 'CC-BY'), source(2, false, null)],
  };
}

describe('public word policy', () => {
  it('requires published, not deleted, pure words with a meaning', () => {
    expect(PUBLIC_WORD_WHERE).toEqual({
      status: 'published',
      deletedAt: null,
      isPure: true,
      meanings: { some: {} },
    });
  });

  it('lists only published, not deleted Levels in orderIndex order', () => {
    expect(PUBLIC_WORD_LEVELS.where).toEqual({
      level: { status: 'published', deletedAt: null },
    });
    expect(PUBLIC_WORD_LEVELS.orderBy).toEqual({
      level: { orderIndex: 'asc' },
    });
    expect(WORD_DETAIL_INCLUDE.wordLevels).toBe(PUBLIC_WORD_LEVELS);
  });

  it('orders meanings by meaningOrder and the primary source first', () => {
    expect(WORD_DETAIL_INCLUDE.meanings.orderBy).toEqual({
      meaningOrder: 'asc',
    });
    expect(WORD_DETAIL_INCLUDE.sources.orderBy).toEqual([
      { isPrimary: 'desc' },
      { dataSourceId: 'asc' },
    ]);
  });
});

describe('toWordDetail', () => {
  it('maps the public fields in contract order and keeps nulls', () => {
    const detail = toWordDetail(wordRecord());

    expect(Object.keys(detail)).toEqual([
      'id',
      'hanzi',
      'traditional',
      'pinyin',
      'pinyinTone',
      'example',
      'meanings',
      'levels',
      'sources',
    ]);
    expect(detail).toEqual({
      id: 12,
      hanzi: '学习',
      traditional: '學習',
      pinyin: 'xué xí',
      pinyinTone: 'xue2 xi2',
      example: null,
      meanings: [
        {
          order: 1,
          en: 'to study',
          vi: 'học tập',
          partOfSpeech: 'verb',
          usage: null,
          note: null,
        },
        {
          order: 2,
          en: 'to learn',
          vi: null,
          partOfSpeech: null,
          usage: null,
          note: null,
        },
      ],
      levels: [{ code: 'HSK1', name: 'HSK 1' }],
      sources: [
        {
          name: 'Source 9',
          version: '1.0.0',
          license: 'CC-BY',
          attribution: null,
        },
        {
          name: 'Source 2',
          version: '1.0.0',
          license: null,
          attribution: null,
        },
      ],
    });
  });

  it('does not expose internal or media fields', () => {
    const serialized = JSON.stringify(toWordDetail(wordRecord()));

    for (const field of [
      'status',
      'isPure',
      'audio',
      'image',
      'strokeAnimation',
      'createdById',
      'updatedById',
      'publishedById',
      'createdAt',
      'updatedAt',
      'referenceUrl',
      'userId',
    ]) {
      expect(serialized).not.toContain(`"${field}`);
    }
  });
});

describe('word save limit', () => {
  it.each([
    ['production', 60],
    ['test', 1_000],
  ])('resolves under NODE_ENV=%s', (nodeEnv, limit) => {
    withNodeEnv(nodeEnv, () => expect(wordSaveLimit()).toBe(limit));
  });

  it.each(['saveWord', 'unsaveWord'] as const)(
    'throttles DictionaryController.%s with wordSaveLimit',
    (method) => {
      const limit: unknown = Reflect.getMetadata(
        'THROTTLER:LIMITdefault',
        DictionaryController.prototype[method],
      );
      expect(limit).toBe(wordSaveLimit);
    },
  );
});

describe('dictionary read limit', () => {
  it.each([
    ['production', 120],
    ['test', 1_000],
  ])('resolves under NODE_ENV=%s', (nodeEnv, limit) => {
    withNodeEnv(nodeEnv, () => expect(dictionaryReadLimit()).toBe(limit));
  });

  it.each(['search', 'getWord', 'getSaved'] as const)(
    'throttles DictionaryController.%s with dictionaryReadLimit',
    (method) => {
      const limit: unknown = Reflect.getMetadata(
        'THROTTLER:LIMITdefault',
        DictionaryController.prototype[method],
      );
      expect(limit).toBe(dictionaryReadLimit);
    },
  );
});
