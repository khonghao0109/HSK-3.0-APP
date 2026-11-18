import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildLevelLexicon,
  loadLevelLexicon,
} from '../content-levels/level-vocabulary';
import {
  examQuestionTexts,
  grammarContentSha256,
  type GrammarPointFile,
  isApproved,
  linksContentSha256,
  type QuestionLinksFile,
  validateGrammarPoints,
  validateQuestionLinks,
} from './grammar-links';

const root = join(__dirname, '../../..');
const read = <T>(path: string) =>
  JSON.parse(readFileSync(join(root, path), 'utf8')) as T;

const pending = {
  status: 'pending',
  reviewer: null,
  reviewedAt: null,
  contentSha256: null,
  notes: [],
};

describe('grammar points and question links (Q357)', () => {
  it('repository files are valid and approved with matching hashes', () => {
    const lexicon = loadLevelLexicon(root);
    const grammar = read<GrammarPointFile>('content/hsk1/grammar/points.json');
    const links = read<QuestionLinksFile>(
      'content/hsk1/exam/mock-01-links.json',
    );
    const exam = read<Parameters<typeof examQuestionTexts>[0]>(
      'content/hsk1/exam/mock-01.json',
    );
    expect(validateGrammarPoints(grammar, lexicon)).toEqual([]);
    expect(
      validateQuestionLinks(links, examQuestionTexts(exam), grammar, lexicon),
    ).toEqual([]);
    expect(Object.keys(links.questions)).toHaveLength(40);
    const bankLinks = read<QuestionLinksFile>(
      'content/hsk1/exam/bank-reading-01-links.json',
    );
    const bank = read<Parameters<typeof examQuestionTexts>[0]>(
      'content/hsk1/exam/bank-reading-01.json',
    );
    expect(
      validateQuestionLinks(
        bankLinks,
        examQuestionTexts(bank),
        grammar,
        lexicon,
      ),
    ).toEqual([]);
    expect(Object.keys(bankLinks.questions)).toHaveLength(45);
    // Q358: PO uỷ quyền cho Claude duyệt 18/11/2026; hash khớp nội dung.
    expect(isApproved(grammar.review, grammarContentSha256(grammar))).toBe(
      true,
    );
    expect(isApproved(links.review, linksContentSha256(links))).toBe(true);
    expect(isApproved(bankLinks.review, linksContentSha256(bankLinks))).toBe(
      true,
    );
  });

  const lexicon = buildLevelLexicon({
    HSK1: ['我', '喝', '茶', '在'],
    HSK2: ['咖啡'],
  });
  const grammar: GrammarPointFile = {
    schemaVersion: 1,
    level: 'HSK1',
    dataSource: { code: 'X' },
    review: pending,
    points: [
      {
        code: 'HSK1-G001',
        category: 'Phó từ',
        title: 'Đang làm',
        pattern: 'S + 在 + V',
        descriptionVi: 'mô tả',
        examples: [{ hanzi: '我在喝茶。', pinyin: 'Wǒ zài hē chá.', vi: 'x' }],
      },
    ],
  };

  it('flags code sequence, blanks and examples above level', () => {
    const bad: GrammarPointFile = {
      ...grammar,
      points: [
        {
          ...grammar.points[0],
          code: 'HSK1-G002',
          title: ' ',
          examples: [{ hanzi: '我喝咖啡。', pinyin: 'p', vi: 'v' }],
        },
      ],
    };
    expect(validateGrammarPoints(bad, lexicon).map((i) => i.code)).toEqual([
      'code_sequence',
      'field_blank',
      'example_above_level',
    ]);
    expect(validateGrammarPoints(grammar, lexicon)).toEqual([]);
  });

  it('flags target words outside the level or the question, and unknown grammar', () => {
    const links: QuestionLinksFile = {
      schemaVersion: 1,
      review: pending,
      questions: {
        'q:1': { targetWords: ['茶', '咖啡', '我'], grammar: ['HSK1-G009'] },
        'q:x': { targetWords: ['茶'], grammar: [] },
      },
    };
    const issues = validateQuestionLinks(
      links,
      [
        { sourceKey: 'q:1', text: '我在喝茶' },
        { sourceKey: 'q:2', text: '我' },
      ],
      grammar,
      lexicon,
    ).map((i) => `${i.code} ${i.path}`);
    expect(issues).toEqual([
      'question_unlinked q:2',
      'target_above_level q:1.targetWords',
      'target_not_in_question q:1.targetWords',
      'grammar_unknown q:1.grammar',
      'question_unknown q:x',
    ]);
  });

  it('only approves a reviewed file whose hash matches', () => {
    const sha = grammarContentSha256(grammar);
    expect(isApproved(pending, sha)).toBe(false);
    const approved = {
      status: 'approved',
      reviewer: 'PO',
      reviewedAt: '2026-11-19',
      contentSha256: sha,
      notes: [],
    };
    expect(isApproved(approved, sha)).toBe(true);
    expect(isApproved({ ...approved, contentSha256: 'x' }, sha)).toBe(false);
    expect(isApproved({ ...approved, reviewer: ' ' }, sha)).toBe(false);
  });
});
