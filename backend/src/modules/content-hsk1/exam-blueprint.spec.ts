import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type BlueprintFile, validateBlueprintFile } from './exam-blueprint';

const root = join(__dirname, '../../..');
const read = <T>(path: string) =>
  JSON.parse(readFileSync(join(root, path), 'utf8')) as T;

describe('exam blueprint file (Q357)', () => {
  const file = read<BlueprintFile>('content/hsk1/exam/blueprint-hsk1.json');

  it('HSK1 blueprints are valid', () => {
    expect(validateBlueprintFile(file)).toEqual([]);
    expect(file.blueprints.map((bp) => bp.code)).toEqual([
      'hsk1-standard',
      'hsk1-reading',
    ]);
  });

  it('matches the structure and tags of mock-01', () => {
    type Mock = {
      sections: {
        skill: string;
        parts: { key: string; questions: { tags: string[] }[] }[];
      }[];
    };
    const mock = read<Mock>('content/hsk1/exam/mock-01.json');
    const full = file.blueprints[0];
    expect(full?.sections.map((s) => s.skill)).toEqual(
      mock.sections.map((s) => s.skill),
    );
    for (const section of full?.sections ?? []) {
      for (const part of section.parts) {
        const source = mock.sections
          .flatMap((s) => s.parts)
          .find((p) => p.key === part.key);
        expect(source?.questions).toHaveLength(part.questionCount);
        for (const question of source?.questions ?? [])
          expect(question.tags).toContain(part.format);
      }
    }
  });

  it('reports invalid fields', () => {
    const bad = {
      schemaVersion: 2,
      blueprints: [
        {
          code: 'Bad Code',
          level: 'HSK1',
          title: ' ',
          instruction: null,
          durationMinutes: 0,
          passScore: 500,
          version: 0,
          status: 'archived',
          sections: [
            {
              skill: 'drawing',
              title: 'x',
              instruction: null,
              parts: [
                {
                  key: 'a',
                  title: 'p',
                  instruction: null,
                  questionType: 'essay',
                  format: 'Not Slug',
                  questionCount: 0,
                  fromSet: false,
                },
                {
                  key: 'a',
                  title: 'p',
                  instruction: null,
                  questionType: 'mcq',
                  format: 'ok',
                  questionCount: 1,
                  fromSet: false,
                },
              ],
            },
          ],
        },
      ],
    } as BlueprintFile;
    expect(validateBlueprintFile(bad)).toHaveLength(12);
  });
});
