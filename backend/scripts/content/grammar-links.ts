import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';

import {
  examQuestionTexts,
  grammarContentSha256,
  type GrammarPointFile,
  importGrammarPoints,
  importQuestionLinks,
  isApproved,
  linksContentSha256,
  type QuestionLinksFile,
  validateGrammarPoints,
  validateQuestionLinks,
} from '../../src/modules/content-hsk1/grammar-links';
import { loadLevelLexicon } from '../../src/modules/content-levels/level-vocabulary';

/**
 * Q357: kiểm / nạp điểm ngữ pháp và liên kết câu hỏi (từ đích, ngữ pháp).
 *   npm run content:check:grammar        # kiểm + in hash cho người duyệt
 *   DATABASE_URL=... npm run content:import:grammar -- [--ledger <exam-ledger.json>]
 * Chỉ nạp phần đã được PO duyệt (review approved + hash khớp).
 */
const root = resolve(__dirname, '../..');
const read = <T>(path: string) =>
  JSON.parse(readFileSync(resolve(root, path), 'utf8')) as T;
const args = process.argv.slice(2);
const mode = args[0];
const ledgerIndex = args.indexOf('--ledger');
const ledgerPath = ledgerIndex >= 0 ? args[ledgerIndex + 1] : undefined;

const grammar = read<GrammarPointFile>('content/hsk1/grammar/points.json');
const links = read<QuestionLinksFile>('content/hsk1/exam/mock-01-links.json');
const exam = read<Parameters<typeof examQuestionTexts>[0]>(
  'content/hsk1/exam/mock-01.json',
);
const lexicon = loadLevelLexicon(root);
// Q357: PO giữ 怎么样 (HSK2) trong mock-01 – chỉ ảnh hưởng kiểm cấp đề, không phải từ đích.
const issues = [
  ...validateGrammarPoints(grammar, lexicon),
  ...validateQuestionLinks(links, examQuestionTexts(exam), grammar, lexicon),
];
const grammarSha = grammarContentSha256(grammar);
const linksSha = linksContentSha256(links);
console.log(
  `grammar: ${grammar.points.length} điểm, review=${grammar.review.status}, contentSha256=${grammarSha}`,
);
console.log(
  `links: ${Object.keys(links.questions).length} câu, review=${links.review.status}, contentSha256=${linksSha}`,
);
for (const issue of issues)
  console.log(`  ${issue.code} ${issue.path} ${issue.message}`);
if (issues.length) process.exit(1);

async function importAll() {
  const prisma = new PrismaClient();
  try {
    if (isApproved(grammar.review, grammarSha))
      console.log(JSON.stringify(await importGrammarPoints(prisma, grammar)));
    else console.log('grammar: chưa duyệt, bỏ qua');
    if (!ledgerPath) return;
    if (!isApproved(links.review, linksSha)) {
      console.log('links: chưa duyệt, bỏ qua');
      return;
    }
    const ledger = JSON.parse(readFileSync(resolve(ledgerPath), 'utf8')) as {
      questions: Record<string, { id: number }>;
    };
    console.log(
      JSON.stringify(
        await importQuestionLinks(prisma, {
          links,
          level: grammar.level,
          questionIds: ledger.questions,
        }),
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (mode === 'import')
  void importAll().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
