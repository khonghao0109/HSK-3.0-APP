import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { validateTopicContentBlocks } from '../../common/validation/topic-content-blocks';

import {
  convertTextbookSeeddata,
  fixBrevePinyin,
  serializeTextbookLesson,
  TextbookSeeddataError,
} from './textbook-seeddata.converter';

const FIXTURES = join(__dirname, '../../../test/fixtures/textbook');
const load = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as unknown;

function convert(
  overrides: Partial<{
    vocab: unknown;
    lessons: unknown;
    from: number;
    to: number;
  }> = {},
) {
  return convertTextbookSeeddata({
    vocab: overrides.vocab ?? load('hsk1-vocab.json'),
    lessons: overrides.lessons ?? load('hsk1-lessons.json'),
    grade: 1,
    from: overrides.from ?? 1,
    to: overrides.to ?? 2,
  });
}

function issuesOf(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof TextbookSeeddataError) {
      return error.issues.map((issue) => `${issue.code} ${issue.path}`);
    }
    throw error;
  }
  throw new Error('expected TextbookSeeddataError');
}

describe('convertTextbookSeeddata (M2.13a)', () => {
  it('builds one textbook file per lesson with the agreed shape', () => {
    const files = convert();
    expect(files.map((file) => file.fileName)).toEqual([
      'lesson-01.json',
      'lesson-02.json',
    ]);
    const first = files[0].content;
    expect(first).toMatchObject({
      format: 'textbook',
      formatVersion: 1,
      course: {
        code: 'HSK2_TEXTBOOK',
        kind: 'textbook',
        curriculumVersion: 'HSK_2_0',
      },
      unit: { gradeNumber: 1, volume: null, orderIndex: 1 },
      dataSource: { code: 'HSK20_TEXTBOOK_PO_V1', version: '1.0.0' },
      lesson: {
        sourceKey: 'hsk2-textbook:g1:l01',
        slug: 'hsk2-textbook-g1-l01-chao-hoi-thu-nghiem',
        title: 'Chào hỏi thử nghiệm',
        description: '犇骉',
        orderIndex: 1,
      },
    });
    expect(files[1].content.lesson.slug).toBe(
      'hsk2-textbook-g1-l02-dem-so-don-gian',
    );
    expect(first.words).toEqual([
      {
        hanzi: '犇',
        pinyin: 'bēn',
        meaningVi: 'chạy (từ thử)',
        partOfSpeech: 'động từ',
        audioRef: 't1_ben.mp3',
        topicKey: 'vocabulary',
      },
      {
        hanzi: '骉',
        pinyin: 'biāo',
        meaningVi: 'ngựa chạy (từ thử)',
        partOfSpeech: 'danh từ',
        audioRef: 't1_biao.mp3',
        topicKey: 'vocabulary',
      },
    ]);
    expect(first.topics.map((topic) => [topic.key, topic.type])).toEqual([
      ['vocabulary', 'vocabulary'],
      ['key_text', 'key_text'],
      ['grammar', 'grammar'],
    ]);
    expect(first.keyTextAudioRefs).toEqual([
      't1_kt1.mp3',
      't1_kt1_1.mp3',
      't1_kt1_2.mp3',
    ]);
  });

  it('uses only content blocks the CMS already validates', () => {
    for (const { content } of convert()) {
      for (const topic of content.topics) {
        expect(validateTopicContentBlocks(topic.type, topic.content)).toEqual(
          [],
        );
        for (const block of topic.content) {
          expect([
            'vocabulary_list',
            'dialogue',
            'text',
            'grammar_point',
          ]).toContain(block.type);
        }
      }
    }
    const [, second] = convert();
    // A paragraph has no speakers: it becomes text blocks, not a dialogue.
    expect(
      second.content.topics.find((topic) => topic.key === 'key_text')?.content,
    ).toEqual([{ type: 'text', value: '猋犇。\nBiāo bēn.\nĐoạn thử.' }]);
  });

  it('is deterministic: the same input gives byte-identical output', () => {
    const a = convert().map((file) => serializeTextbookLesson(file.content));
    const b = convert().map((file) => serializeTextbookLesson(file.content));
    expect(a).toEqual(b);
    expect(a[0].endsWith('\n')).toBe(true);
  });

  it('skips the trailing "Từ vựng bổ sung" entry', () => {
    const words = convert().flatMap((file) =>
      file.content.words.map((word) => word.hanzi),
    );
    expect(words).not.toContain('羴');
  });

  it('honours the lesson range', () => {
    expect(convert({ from: 2, to: 2 }).map((file) => file.fileName)).toEqual([
      'lesson-02.json',
    ]);
  });

  it('points at the exact field of an unknown, mistyped or empty value', () => {
    const vocab = load('hsk1-vocab.json') as Array<Record<string, unknown>>;
    const words = vocab[0].tu_vung as Array<Record<string, unknown>>;
    words[1] = { ...words[1], extra: 'x' };
    words[0] = { ...words[0], han: '  ' };
    const lessons = load('hsk1-lessons.json') as Array<Record<string, unknown>>;
    lessons[1] = { ...lessons[1], bai: '2' };
    expect(issuesOf(() => convert({ vocab, lessons }))).toEqual([
      'field_empty vocab[0].tu_vung[0].han',
      'field_unknown vocab[0].tu_vung[1].extra',
      'field_type lessons[1].bai',
    ]);
  });

  it('reports lessons present in only one of the two files', () => {
    const lessons = (
      load('hsk1-lessons.json') as Array<Record<string, unknown>>
    ).slice(0, 1);
    expect(issuesOf(() => convert({ lessons }))).toEqual([
      'lesson_missing_in_lessons vocab bai=2',
    ]);
    const vocab = (load('hsk1-vocab.json') as unknown[]).filter(
      (_, index) => index !== 1,
    );
    expect(issuesOf(() => convert({ vocab }))).toEqual([
      'lesson_missing_in_vocab lessons bai=2',
    ]);
  });

  it('keeps optional-empty seeddata fields explicit', () => {
    const [, second] = convert();
    // Empty `pos` in seeddata → no part of speech, never a guessed one.
    expect(second.content.words[1].partOfSpeech).toBeNull();
    const lessons = load('hsk1-lessons.json') as Array<Record<string, unknown>>;
    const grammar = lessons[0].ngu_phap as Array<Record<string, unknown>>;
    grammar[0] = { ...grammar[0], structure: '', meaning: '' };
    // M2.13b FIX: the example without a meaning is dropped, not an error.
    expect(convert({ lessons })[0].content.grammarExamplesSkipped).toBe(1);
    grammar[0] = { ...grammar[0], meaning: 'Câu thử.' };
    const [first] = convert({ lessons });
    const point = first.content.topics.find((t) => t.key === 'grammar')
      ?.content[0];
    // Empty structure → the chips come from the pattern.
    expect(point).toMatchObject({
      formula: [
        { role: 'key', zh: '犇', vi: '犇' },
        { role: 'key', zh: '骉', vi: '骉' },
      ],
    });
  });

  it('splits an over-long formula chip on spaces and never emits an invalid block', () => {
    const lessons = load('hsk1-lessons.json') as Array<Record<string, unknown>>;
    const grammar = lessons[0].ngu_phap as Array<Record<string, unknown>>;
    // 26 characters without "+": too long for one chip (zh ≤ 20).
    grammar[0] = { ...grammar[0], structure: 'Chủ ngữ 犇 động từ 骉 tân ngữ' };
    const [first] = convert({ lessons });
    const topic = first.content.topics.find((t) => t.key === 'grammar');
    expect(topic?.content[0]).toMatchObject({
      formula: [
        { role: 'other', zh: 'Chủ' },
        { role: 'other', zh: 'ngữ' },
        { role: 'key', zh: '犇' },
        { role: 'other', zh: 'động' },
        { role: 'other', zh: 'từ' },
        { role: 'key', zh: '骉' },
        { role: 'other', zh: 'tân' },
        { role: 'other', zh: 'ngữ' },
      ],
    });
    grammar[0] = { ...grammar[0], structure: '犇'.repeat(21) };
    expect(issuesOf(() => convert({ lessons }))).toEqual([
      'block_invalid lessons bai=1 grammar content[0].formula[0].zh',
    ]);
  });
});

describe('convertTextbookSeeddata classroom phrases and exercises (M2.13b)', () => {
  const ext = (from: number, to: number) =>
    convertTextbookSeeddata({
      vocab: load('hsk1-ext-vocab.json'),
      lessons: load('hsk1-ext-lessons.json'),
      grade: 1,
      from,
      to,
    });

  it('moves classroom phrases out of words into a valid vocabulary block', () => {
    const [third] = ext(3, 3);
    expect(third.content.words.map((word) => word.hanzi)).toEqual([
      '龘',
      '鱻',
      '毳',
      '淼',
      '焱',
      '垚',
    ]);
    const vocabulary = third.content.topics.find((t) => t.key === 'vocabulary');
    expect(vocabulary?.content).toEqual([
      { type: 'vocabulary_list', value: 'lesson_words' },
      {
        type: 'text',
        value:
          'Câu dùng trong lớp\n龘鱻！ — Dá xiān! — Câu lớp thử một.\n毳淼? — Cuì miǎo? — Câu lớp thử hai.',
      },
    ]);
    expect(
      validateTopicContentBlocks('vocabulary', vocabulary?.content ?? []),
    ).toEqual([]);
    expect(third.content.classroomPhrases).toHaveLength(2);
  });

  it('keeps a lesson that has only classroom phrases', () => {
    const [fourth] = ext(4, 4);
    expect(fourth.content.words).toEqual([]);
    expect(fourth.content.exercises).toEqual([]);
    expect(fourth.content.classroomPhrases.map((p) => p.hanzi)).toEqual([
      '焱垚。',
      '垚，焱',
    ]);
  });

  it('generates exercises from the real words of the grade only', () => {
    const [third] = ext(3, 3);
    expect(third.content.exercises.map((e) => e.sourceKey)[0]).toBe(
      'hsk2-textbook:g1:l03:e01',
    );
    expect(third.content.exercises).toHaveLength(14);
    expect(third.content.exerciseSkips).toEqual({
      mcqMeaning: 0,
      mcqHanzi: 0,
      duplicateWords: 0,
    });
    const text = JSON.stringify(third.content.exercises);
    expect(text).not.toContain('！');
    expect(text).not.toContain('Câu lớp thử');
    for (const e of third.content.exercises) {
      expect(e.topicKey).toBe('vocabulary');
    }
    // Lesson 1 has 2 words: no matching, but mcq draws on the whole grade.
    const [first] = ext(1, 1);
    expect(first.content.exercises.map((e) => e.type)).toEqual([
      'mcq',
      'mcq',
      'mcq',
      'mcq',
    ]);
  });

  it('is byte-identical across two runs', () => {
    const a = ext(1, 4).map((f) => serializeTextbookLesson(f.content));
    const b = ext(1, 4).map((f) => serializeTextbookLesson(f.content));
    expect(a).toEqual(b);
  });

  it('converts the whole grade when `to` is omitted', () => {
    const files = convertTextbookSeeddata({
      vocab: load('hsk1-ext-vocab.json'),
      lessons: load('hsk1-ext-lessons.json'),
      grade: 1,
      from: 1,
    });
    expect(files.map((f) => f.fileName)).toEqual([
      'lesson-01.json',
      'lesson-02.json',
      'lesson-03.json',
      'lesson-04.json',
    ]);
  });
});

describe('seeddata repairs (M2.13b FIX)', () => {
  it('turns breve vowels into third-tone carons, nothing else', () => {
    expect(fixBrevePinyin('nă')).toEqual({ value: 'nǎ', count: 1 });
    expect(fixBrevePinyin('Nĕ Hĭ ŏ ŭ')).toEqual({
      value: 'Ně Hǐ ǒ ǔ',
      count: 4,
    });
    expect(fixBrevePinyin('ĂĔĬŎŬ')).toEqual({ value: 'ǍĚǏǑǓ', count: 5 });
    expect(fixBrevePinyin('nǎ nà na ná nā lǚ ü')).toEqual({
      value: 'nǎ nà na ná nā lǚ ü',
      count: 0,
    });
  });

  const lessonOne = () => {
    const vocab = load('hsk1-ext-vocab.json') as Array<Record<string, unknown>>;
    const lessons = load('hsk1-ext-lessons.json') as Array<
      Record<string, unknown>
    >;
    return { vocab, lessons };
  };

  it('repairs breve pinyin in words, key texts and grammar, and counts it', () => {
    const { vocab, lessons } = lessonOne();
    const words = vocab[0].tu_vung as Array<Record<string, unknown>>;
    words[0] = { ...words[0], pinyin: 'bĕn' };
    const text = (lessons[0].bai_khoa as Array<Record<string, unknown>>)[0];
    const lines = text.content as Array<Record<string, unknown>>;
    lines[0] = { ...lines[0], pinyin: 'Bĕn biăo!' };
    const grammar = lessons[0].ngu_phap as Array<Record<string, unknown>>;
    grammar[0] = { ...grammar[0], pinyin: 'Bĕn' };
    const [first] = convertTextbookSeeddata({
      vocab,
      lessons,
      grade: 1,
      from: 1,
      to: 1,
    });
    expect(first.content.words[0].pinyin).toBe('běn');
    expect(first.content.pinyinFixes).toBe(4);
    expect(serializeTextbookLesson(first.content)).not.toMatch(/[ăĕĭŏŭ]/u);
  });

  it('drops a repeated word of a lesson (first kept) and counts it', () => {
    const { vocab, lessons } = lessonOne();
    const words = vocab[2].tu_vung as Array<Record<string, unknown>>;
    words.push({ ...words[0], id: 99 });
    const [third] = convertTextbookSeeddata({
      vocab,
      lessons,
      grade: 1,
      from: 3,
      to: 3,
    });
    expect(third.content.words.map((w) => w.hanzi)).toEqual([
      '龘',
      '鱻',
      '毳',
      '淼',
      '焱',
      '垚',
    ]);
    expect(third.content.exerciseSkips.duplicateWords).toBe(1);
  });

  it('drops grammar examples without a meaning, never inventing one', () => {
    const { vocab, lessons } = lessonOne();
    const grammar = lessons[0].ngu_phap as Array<Record<string, unknown>>;
    grammar[0] = { ...grammar[0], meaning: '' };
    const [first] = convertTextbookSeeddata({
      vocab,
      lessons,
      grade: 1,
      from: 1,
      to: 1,
    });
    expect(first.content.grammarExamplesSkipped).toBe(1);
    expect(first.content.grammarPointsSkipped).toBe(0);
    const topic = first.content.topics.find((t) => t.key === 'grammar');
    // No example left: the point keeps its title and explanation as text.
    expect(topic?.content).toEqual([
      { type: 'text', value: '犇 + 骉\nGiải thích thử cho mẫu câu.' },
    ]);
    expect(validateTopicContentBlocks('grammar', topic?.content ?? [])).toEqual(
      [],
    );
    expect(JSON.stringify(topic)).not.toContain('犇骉！');

    grammar[0] = { ...grammar[0], meaning: '', explanation: '' };
    const [again] = convertTextbookSeeddata({
      vocab,
      lessons,
      grade: 1,
      from: 1,
      to: 1,
    });
    expect(again.content.grammarPointsSkipped).toBe(1);
    expect(again.content.topics.map((t) => t.key)).toEqual([
      'vocabulary',
      'key_text',
    ]);
  });
});

describe('word cleaning rules (M2.13b FIX-2)', () => {
  const fixtures = () => ({
    vocab: load('hsk1-ext-vocab.json') as Array<Record<string, unknown>>,
    lessons: load('hsk1-ext-lessons.json') as Array<Record<string, unknown>>,
  });
  const lessonThree = (vocab: Array<Record<string, unknown>>) =>
    vocab[2].tu_vung as Array<Record<string, unknown>>;
  const convertThree = (
    vocab: Array<Record<string, unknown>>,
    lessons: Array<Record<string, unknown>>,
  ) =>
    convertTextbookSeeddata({ vocab, lessons, grade: 1, from: 3, to: 3 })[0]
      .content;

  it('strips a trailing (…) note and dedupes the stripped word', () => {
    const { vocab, lessons } = fixtures();
    const words = lessonThree(vocab);
    words.push({ ...words[0], id: 98, han: '龘 (龍)', pinyin: 'dá (lóng)' });
    words.push({
      ...words[1],
      id: 99,
      han: '犇（牛）',
      pinyin: 'bēn',
      vi: 'chạy',
    });
    const third = convertThree(vocab, lessons);
    expect(third.words.map((w) => w.hanzi)).toEqual([
      '龘',
      '鱻',
      '毳',
      '淼',
      '焱',
      '垚',
      '犇',
    ]);
    expect(third.parentheticalStripped).toBe(2);
    expect(third.exerciseSkips.duplicateWords).toBe(1);
  });

  it('moves a sentence pattern into the classroom block, never a word', () => {
    const { vocab, lessons } = fixtures();
    const words = lessonThree(vocab);
    words.push({
      ...words[0],
      id: 97,
      han: '龘......鱻',
      pinyin: 'dá......xiān',
      vi: 'mẫu câu',
    });
    const third = convertThree(vocab, lessons);
    expect(third.words.map((w) => w.hanzi)).not.toContain('龘......鱻');
    expect(third.patternsMoved).toBe(1);
    const block = third.topics[0].content.find((b) => b.type === 'text');
    expect(block?.value.split('\n')[0]).toBe('Câu và cấu trúc dùng trong lớp');
    expect(block?.value).toContain('龘......鱻 — dá......xiān — mẫu câu');
  });

  it('keeps the old block title and zero counters without patterns', () => {
    const { vocab, lessons } = fixtures();
    const third = convertThree(vocab, lessons);
    const block = third.topics[0].content.find((b) => b.type === 'text');
    expect(block?.value.split('\n')[0]).toBe('Câu dùng trong lớp');
    expect(third.parentheticalStripped).toBe(0);
    expect(third.patternsMoved).toBe(0);
  });
});
