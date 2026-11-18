import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { BlueprintFile } from './exam-blueprint';
import {
  annotationIssues,
  type BankFile,
  type BankQuestion,
  validateBankFiles,
} from './exam-bank';
import { loadHsk1Lexicon } from './meaning-batch';

const root = join(__dirname, '../../..');
const read = <T>(name: string) =>
  JSON.parse(readFileSync(join(root, 'content/hsk1/exam', name), 'utf8')) as T;
const syllables = loadHsk1Lexicon(root).syllables;
const blueprints = read<BlueprintFile>('blueprint-hsk1.json');

describe('exam question files (Q357)', () => {
  it('mock-01 and bank-reading-01 are valid together', () => {
    const files = ['mock-01.json', 'bank-reading-01.json'].map((path) => ({
      path,
      file: read<BankFile>(path),
    }));
    expect(validateBankFiles(files, blueprints, syllables)).toEqual([]);
    const bank = files[1]?.file;
    const byPart = new Map<string, number>();
    for (const part of bank?.sections[0]?.parts ?? [])
      byPart.set(
        part.blueprintPart ?? part.key,
        (byPart.get(part.blueprintPart ?? part.key) ?? 0) +
          part.questions.length,
      );
    expect(Object.fromEntries(byPart)).toEqual({ r2: 15, r3: 15, r4: 15 });
  });

  it('checks pinyin syllables against Han characters', () => {
    expect(
      annotationIssues('我很（ ）喝茶。 (Wǒ hěn ( ) hē chá.)', syllables),
    ).toEqual([]);
    expect(
      annotationIssues(
        '小雨买了什么？ (Xiǎoyǔ mǎi le shénme?) ★ 书 (shū)',
        syllables,
      ),
    ).toEqual([]);
    expect(annotationIssues('我喝茶。 (Wǒ hē.)', syllables)).toHaveLength(1);
    expect(annotationIssues('我喝茶。', syllables)).toEqual([
      'thiếu pinyin trong ngoặc',
    ]);
  });

  it('flags broken sets, wrong tags and duplicates', () => {
    const q = (key: string, answer: string, extra = {}): BankQuestion => ({
      sourceKey: `t:${key}`,
      type: 'mcq',
      prompt: `我在喝茶${key.length}。 (Wǒ zài hē chá.)`.replace(/\d/u, ''),
      options: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({
        id: `opt-${id}`,
        text: '茶 (chá)',
      })),
      answer: { optionId: `opt-${answer}` },
      explanation: 'x',
      difficulty: 2,
      tags: ['doc-ghep-cau'],
      ...extra,
    });
    const file: BankFile = {
      test: { sourceKey: 't:x' },
      sections: [
        {
          skill: 'reading',
          parts: [
            {
              key: 's1',
              blueprintPart: 'r2',
              questions: [
                q('q1', 'a'),
                q('q2', 'a'),
                q('q3', 'b', { tags: ['khac'] }),
                q('q4', 'c'),
              ],
            },
          ],
        },
      ],
    };
    const codes = validateBankFiles(
      [{ path: 'x', file }],
      blueprints,
      syllables,
    ).map((issue) => issue.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'prompt_duplicate',
        'format_tag_missing',
        'set_size',
        'set_answer_reused',
        'set_extra_option',
      ]),
    );
  });
});
