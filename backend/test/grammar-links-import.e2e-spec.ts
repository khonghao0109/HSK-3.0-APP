/// <reference types="jest" />

import {
  ContentStatus,
  PrismaClient,
  QuestionType,
  Skill,
} from '@prisma/client';

import {
  grammarContentSha256,
  type GrammarPointFile,
  importGrammarPoints,
  importQuestionLinks,
  linksContentSha256,
  type QuestionLinksFile,
} from '../src/modules/content-hsk1/grammar-links';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

/** Q357: nạp điểm ngữ pháp + liên kết câu hỏi chỉ khi PO đã duyệt. */
describe('Grammar points and question links import (Q357)', () => {
  const prisma = new PrismaClient();
  const suffix = `${Date.now()}`;
  // Mã riêng cho lần chạy (cấp HSK7_9 → tiền tố HSK7_9-G).
  const level = 'HSK7-9';
  const codes = ['HSK7_9-G001', 'HSK7_9-G002'];
  let questionId: number;
  let wordId: number;
  const pending = {
    status: 'pending',
    reviewer: null,
    reviewedAt: null,
    contentSha256: null,
    notes: [],
  };
  const approve = <T extends { review: unknown }>(file: T, sha: string): T => ({
    ...file,
    review: {
      status: 'approved',
      reviewer: 'PO',
      reviewedAt: '2026-11-19',
      contentSha256: sha,
      notes: [],
    },
  });

  beforeAll(async () => {
    assertDisposableTestDatabase();
    const lvl = await prisma.level.upsert({
      where: { code: 'HSK7_9' },
      update: {},
      create: {
        code: 'HSK7_9',
        name: 'HSK7_9',
        orderIndex: 7,
        minBand: 7,
        maxBand: 9,
        curriculumVersion: 'HSK_3_0',
        status: ContentStatus.published,
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    await prisma.grammarPoint.deleteMany({ where: { code: { in: codes } } });
    const word = await prisma.word.create({
      data: {
        hanzi: '龘龘',
        pinyin: `da da ${suffix}`,
        pinyinNormalized: `dada${suffix}`,
        wordLevels: { create: { levelId: lvl.id } },
      },
      select: { id: true },
    });
    wordId = word.id;
    const question = await prisma.question.create({
      data: {
        content: '龘龘',
        type: QuestionType.mcq,
        skill: Skill.reading,
        levelId: lvl.id,
        answers: { options: [{ id: 'a', text: 'A' }] },
        correctAnswer: { optionId: 'a' },
      },
      select: { id: true },
    });
    questionId = question.id;
  });

  afterAll(async () => {
    // An undefined id would widen these filters to every row: skip instead.
    try {
      if (questionId !== undefined) {
        await prisma.question.updateMany({
          where: { id: questionId },
          data: { status: ContentStatus.archived, deletedAt: new Date() },
        });
        await prisma.questionWord.deleteMany({ where: { questionId } });
        await prisma.questionGrammarPoint.deleteMany({ where: { questionId } });
      }
      await prisma.grammarPoint.deleteMany({ where: { code: { in: codes } } });
      if (wordId !== undefined) {
        await prisma.wordLevel.deleteMany({ where: { wordId } });
        await prisma.word.delete({ where: { id: wordId } });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  it('refuses unapproved files, then imports approved grammar and links', async () => {
    const grammar: GrammarPointFile = {
      schemaVersion: 1,
      level,
      dataSource: { code: 'HSK30_GRAMMAR_CLAUDE_DRAFT' },
      review: pending,
      points: codes.map((code, i) => ({
        code,
        category: 'Câu',
        title: `Điểm ${i + 1}`,
        pattern: 'S + V',
        descriptionVi: 'mô tả',
        examples: [{ hanzi: '龘龘', pinyin: 'dá dá', vi: 'x' }],
      })),
    };
    await expect(importGrammarPoints(prisma, grammar)).rejects.toThrow(
      'chưa được PO duyệt',
    );
    const approvedGrammar = approve(grammar, grammarContentSha256(grammar));
    expect(await importGrammarPoints(prisma, approvedGrammar)).toEqual({
      created: 2,
      updated: 0,
    });
    expect(await importGrammarPoints(prisma, approvedGrammar)).toEqual({
      created: 0,
      updated: 2,
    });
    const stored = await prisma.grammarPoint.findMany({
      where: { code: { in: codes } },
      orderBy: { orderIndex: 'asc' },
      select: {
        code: true,
        status: true,
        dataSource: { select: { code: true } },
      },
    });
    expect(stored).toEqual([
      {
        code: codes[0],
        status: 'published',
        dataSource: { code: 'HSK30_GRAMMAR_CLAUDE_DRAFT' },
      },
      {
        code: codes[1],
        status: 'published',
        dataSource: { code: 'HSK30_GRAMMAR_CLAUDE_DRAFT' },
      },
    ]);

    const links: QuestionLinksFile = {
      schemaVersion: 1,
      review: pending,
      questions: { 'e2e:q1': { targetWords: ['龘龘'], grammar: [codes[1]] } },
    };
    const ledger = { 'e2e:q1': { id: questionId } };
    await expect(
      importQuestionLinks(prisma, { links, level, questionIds: ledger }),
    ).rejects.toThrow('chưa được PO duyệt');
    const approvedLinks = approve(links, linksContentSha256(links));
    for (let run = 0; run < 2; run += 1) {
      expect(
        await importQuestionLinks(prisma, {
          links: approvedLinks,
          level,
          questionIds: ledger,
        }),
      ).toEqual({ questions: 1, words: 1, grammar: 1 });
    }
    expect(await prisma.questionWord.count({ where: { questionId } })).toBe(1);
    expect(
      await prisma.questionGrammarPoint.findMany({
        where: { questionId },
        select: { grammarPoint: { select: { code: true } } },
      }),
    ).toEqual([{ grammarPoint: { code: codes[1] } }]);
  });
});
