import { createHash } from 'node:crypto';

import { ContentStatus, PrismaClient } from '@prisma/client';

import { canonicalJson } from '../../common/utils/canonical-json';
import {
  checkTextLevel,
  type HskLevel,
  type LevelLexicon,
} from '../content-levels/level-vocabulary';

/**
 * Q357: điểm ngữ pháp theo cấp (`content/<level>/grammar/points.json`) và liên kết
 * câu hỏi ↔ từ đích / điểm ngữ pháp (`*-links.json`). Đều là bản nháp AI, chỉ nạp
 * khi PO duyệt (`review.status = approved`, có người duyệt, ngày, hash khớp — Q185).
 */
export interface Review {
  readonly status: string;
  readonly reviewer: string | null;
  readonly reviewedAt: string | null;
  readonly contentSha256: string | null;
  readonly notes: readonly string[];
}

export interface GrammarPointFile {
  readonly schemaVersion: number;
  readonly level: HskLevel;
  readonly dataSource: { readonly code: string };
  readonly review: Review;
  readonly points: readonly {
    readonly code: string;
    readonly category: string;
    readonly title: string;
    readonly pattern: string;
    readonly descriptionVi: string;
    readonly examples: readonly {
      readonly hanzi: string;
      readonly pinyin: string;
      readonly vi: string;
    }[];
  }[];
}

export interface QuestionLinksFile {
  readonly schemaVersion: number;
  readonly review: Review;
  readonly questions: Readonly<
    Record<
      string,
      {
        readonly targetWords: readonly string[];
        readonly grammar: readonly string[];
      }
    >
  >;
}

export interface LinkIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

const sha = (value: unknown) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');

export const grammarContentSha256 = (file: GrammarPointFile) =>
  sha({ level: file.level, dataSource: file.dataSource, points: file.points });

export const linksContentSha256 = (file: QuestionLinksFile) =>
  sha({ questions: file.questions });

export function isApproved(review: Review, contentSha256: string): boolean {
  return (
    review.status === 'approved' &&
    Boolean(review.reviewer?.trim()) &&
    /^\d{4}-\d{2}-\d{2}$/u.test(review.reviewedAt ?? '') &&
    review.contentSha256 === contentSha256
  );
}

export function validateGrammarPoints(
  file: GrammarPointFile,
  lexicon: LevelLexicon,
): LinkIssue[] {
  const issues: LinkIssue[] = [];
  const add = (code: string, path: string, message: string) =>
    issues.push({ code, path, message });
  const prefix = file.level.replace('-', '_');
  const codes = new Set<string>();
  for (const [index, point] of (file.points ?? []).entries()) {
    const at = `points[${index}]`;
    const expected = `${prefix}-G${String(index + 1).padStart(3, '0')}`;
    if (point.code !== expected)
      add('code_sequence', `${at}.code`, `phải là ${expected}`);
    if (codes.has(point.code)) add('code_duplicate', `${at}.code`, point.code);
    codes.add(point.code);
    for (const field of [
      'category',
      'title',
      'pattern',
      'descriptionVi',
    ] as const)
      if (!point[field]?.trim()) add('field_blank', `${at}.${field}`, 'trống');
    if (!point.examples?.length)
      add('example_missing', `${at}.examples`, 'cần ít nhất 1 câu ví dụ');
    for (const [e, example] of (point.examples ?? []).entries()) {
      for (const field of ['hanzi', 'pinyin', 'vi'] as const)
        if (!example[field]?.trim())
          add('field_blank', `${at}.examples[${e}].${field}`, 'trống');
      for (const issue of checkTextLevel(
        example.hanzi,
        file.level,
        lexicon,
        `${at}.examples[${e}].hanzi`,
      ))
        add('example_above_level', issue.path, issue.message);
    }
  }
  return issues;
}

/** Văn bản chữ Hán của câu hỏi (đề bài, lời thoại, phương án) để kiểm từ đích. */
export interface LinkedQuestion {
  readonly sourceKey: string;
  readonly text: string;
}

export function validateQuestionLinks(
  file: QuestionLinksFile,
  questions: readonly LinkedQuestion[],
  grammar: GrammarPointFile,
  lexicon: LevelLexicon,
): LinkIssue[] {
  const issues: LinkIssue[] = [];
  const add = (code: string, path: string, message: string) =>
    issues.push({ code, path, message });
  const known = new Map(questions.map((q) => [q.sourceKey, q.text]));
  const codes = new Set(grammar.points.map((point) => point.code));
  const limit = lexicon.levelOf;
  const rank = (level: string) =>
    ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6', 'HSK7-9'].indexOf(level);
  for (const key of known.keys())
    if (!file.questions[key])
      add('question_unlinked', key, 'câu chưa có liên kết');
  for (const [key, links] of Object.entries(file.questions)) {
    const text = known.get(key);
    if (text === undefined) {
      add('question_unknown', key, 'không có trong đề');
      continue;
    }
    if (!links.targetWords.length)
      add('target_missing', `${key}.targetWords`, 'cần ít nhất 1 từ đích');
    if (new Set(links.targetWords).size !== links.targetWords.length)
      add('target_duplicate', `${key}.targetWords`, 'trùng');
    for (const word of links.targetWords) {
      const level = limit.get(word);
      if (!level || rank(level) > rank(grammar.level))
        add(
          'target_above_level',
          `${key}.targetWords`,
          `${word} không phải từ ≤ ${grammar.level}`,
        );
      if (!text.includes(word))
        add(
          'target_not_in_question',
          `${key}.targetWords`,
          `${word} không có trong câu`,
        );
    }
    if (new Set(links.grammar).size !== links.grammar.length)
      add('grammar_duplicate', `${key}.grammar`, 'trùng');
    for (const code of links.grammar)
      if (!codes.has(code))
        add(
          'grammar_unknown',
          `${key}.grammar`,
          `${code} không có trong danh sách`,
        );
  }
  return issues;
}

/** Nạp điểm ngữ pháp đã duyệt (status `published`), idempotent theo `code`. */
export async function importGrammarPoints(
  prisma: PrismaClient,
  file: GrammarPointFile,
): Promise<{ created: number; updated: number }> {
  if (!isApproved(file.review, grammarContentSha256(file)))
    throw new Error(
      'Danh sách ngữ pháp chưa được PO duyệt (hoặc hash không khớp)',
    );
  const level = await prisma.level.findUniqueOrThrow({
    where: { code: file.level.replace('-', '_') },
    select: { id: true },
  });
  const source = await prisma.dataSource.findUniqueOrThrow({
    where: { code: file.dataSource.code },
    select: { id: true },
  });
  const result = { created: 0, updated: 0 };
  await prisma.$transaction(async (tx) => {
    for (const [orderIndex, point] of file.points.entries()) {
      const data = {
        levelId: level.id,
        orderIndex,
        category: point.category,
        title: point.title,
        pattern: point.pattern,
        descriptionVi: point.descriptionVi,
        status: ContentStatus.published,
        dataSourceId: source.id,
      };
      const existing = await tx.grammarPoint.findUnique({
        where: { code: point.code },
        select: { id: true },
      });
      if (existing) {
        await tx.grammarPoint.update({ where: { id: existing.id }, data });
        result.updated += 1;
      } else {
        await tx.grammarPoint.create({ data: { code: point.code, ...data } });
        result.created += 1;
      }
    }
  });
  return result;
}

/**
 * Ghi `QuestionWord` / `QuestionGrammarPoint` cho câu đã nạp (id theo sổ nạp đề).
 * Từ đích tìm trong `Word` có `WordLevel` đúng cấp; nhiều cách đọc cùng chữ → lấy
 * tất cả (cùng một từ đích). Thay toàn bộ liên kết của từng câu.
 */
export async function importQuestionLinks(
  prisma: PrismaClient,
  input: {
    links: QuestionLinksFile;
    level: string;
    questionIds: Readonly<Record<string, { readonly id: number }>>;
  },
): Promise<{ questions: number; words: number; grammar: number }> {
  if (!isApproved(input.links.review, linksContentSha256(input.links)))
    throw new Error(
      'Liên kết câu hỏi chưa được PO duyệt (hoặc hash không khớp)',
    );
  const levelCode = input.level.replace('-', '_');
  const result = { questions: 0, words: 0, grammar: 0 };
  await prisma.$transaction(async (tx) => {
    for (const [key, links] of Object.entries(input.links.questions)) {
      const questionId = input.questionIds[key]?.id;
      if (questionId === undefined) throw new Error(`Sổ thiếu câu ${key}`);
      const words = await tx.word.findMany({
        where: {
          hanzi: { in: [...links.targetWords] },
          deletedAt: null,
          wordLevels: { some: { level: { code: levelCode } } },
        },
        select: { id: true, hanzi: true },
      });
      const missing = links.targetWords.filter(
        (hanzi) => !words.some((word) => word.hanzi === hanzi),
      );
      if (missing.length)
        throw new Error(
          `${key}: không tìm thấy từ ${missing.join(', ')} ở ${levelCode}`,
        );
      const points = await tx.grammarPoint.findMany({
        where: { code: { in: [...links.grammar] } },
        select: { id: true },
      });
      if (points.length !== links.grammar.length)
        throw new Error(`${key}: thiếu điểm ngữ pháp (nạp ngữ pháp trước)`);
      await tx.questionWord.deleteMany({ where: { questionId } });
      await tx.questionGrammarPoint.deleteMany({ where: { questionId } });
      await tx.questionWord.createMany({
        data: words.map((word) => ({ questionId, wordId: word.id })),
      });
      await tx.questionGrammarPoint.createMany({
        data: points.map((point) => ({ questionId, grammarPointId: point.id })),
      });
      result.questions += 1;
      result.words += words.length;
      result.grammar += points.length;
    }
  });
  return result;
}

interface ExamTextSource {
  readonly sections: readonly {
    readonly parts: readonly {
      readonly questions: readonly {
        readonly sourceKey: string;
        readonly prompt: string;
        readonly options: readonly { readonly text: string }[];
        readonly transcript: unknown;
      }[];
    }[];
  }[];
}

/** Ghép đề bài, lời thoại và phương án của mỗi câu trong file đề. */
export function examQuestionTexts(exam: ExamTextSource): LinkedQuestion[] {
  return exam.sections.flatMap((section) =>
    section.parts.flatMap((part) =>
      part.questions.map((question) => {
        const turns =
          question.transcript &&
          typeof question.transcript === 'object' &&
          Array.isArray((question.transcript as { turns?: unknown }).turns)
            ? (question.transcript as { turns: { hanzi?: string }[] }).turns
            : [];
        return {
          sourceKey: question.sourceKey,
          text: [
            question.prompt,
            ...turns.map((turn) => turn.hanzi ?? ''),
            ...question.options.map((option) => option.text),
          ].join('\n'),
        };
      }),
    ),
  );
}
