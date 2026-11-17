import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  TtsItem,
  TtsManifest,
} from '../../src/modules/content-tts/tts-manifest';

/**
 * Dựng manifest TTS cho lát cắt Bài 1 + đề thi thử HSK1 từ file nguồn
 * (lesson-01.json, exam/mock-01.json). Manifest luôn ở `pending`; PO duyệt
 * rồi ghi `review` (Q353). Chạy lại sau khi nguồn đổi:
 *   npx ts-node scripts/content/build-slice-tts-manifest.ts
 */
const root = join(__dirname, '../..');
const FEMALE = 'zh-CN-XiaoxiaoNeural';
const MALE = 'zh-CN-YunxiNeural';
// Giọng dẫn đọc câu "问：…" ở Nghe 4 (PO 18/11/2026).
const NARRATOR = 'zh-CN-YunyangNeural';

interface LessonWord {
  hanzi: string;
  example: { hanzi: string };
}
interface Turn {
  speaker: 'male' | 'female' | 'narrator';
  hanzi: string;
}
interface ExamQuestion {
  sourceKey: string;
  transcript: { turns: Turn[] } | null;
}
interface Exam {
  sections: { parts: { questions: ExamQuestion[] }[] }[];
}

const read = <T>(path: string): T =>
  JSON.parse(readFileSync(join(root, path), 'utf8')) as T;

const lesson = read<{ words: LessonWord[] }>(
  'content/pilot/hsk1/lesson-01.json',
);
const exam = read<Exam>('content/hsk1/exam/mock-01.json');
const pad = (n: number) => String(n).padStart(2, '0');

const items: TtsItem[] = [];
lesson.words.forEach((word, index) => {
  items.push({
    sourceKey: `hsk1:l01:w${pad(index + 1)}`,
    voice: FEMALE,
    text: word.hanzi,
  });
  items.push({
    sourceKey: `hsk1:l01:w${pad(index + 1)}:ex`,
    voice: index % 2 === 0 ? MALE : FEMALE,
    text: word.example.hanzi,
  });
});
for (const section of exam.sections) {
  for (const part of section.parts) {
    for (const question of part.questions) {
      if (question.transcript === null) continue;
      items.push({
        sourceKey: question.sourceKey,
        turns: question.transcript.turns.map((turn) => ({
          voice:
            turn.speaker === 'narrator'
              ? NARRATOR
              : turn.speaker === 'male'
                ? MALE
                : FEMALE,
          text: turn.hanzi,
        })),
        breakMs: 600,
      });
    }
  }
}

const manifest: TtsManifest = {
  schemaVersion: 1,
  manifestId: 'hsk1-slice-01',
  provider: 'azure',
  language: 'zh-CN',
  dataSource: {
    code: 'HSK30_TTS_AZURE_SLICE01',
    name: 'Audio TTS lát cắt Bài 1 + đề thi thử HSK1',
    version: '1',
    license:
      'Azure AI Speech, giọng neural dựng sẵn; output là Customer Data (Q348)',
    attribution: 'Âm thanh được tạo bằng giọng đọc tổng hợp (Azure AI Speech).',
  },
  review: {
    status: 'pending',
    reviewer: null,
    reviewedAt: null,
    contentSha256: null,
  },
  items,
};
writeFileSync(
  join(root, 'content/hsk1/audio/slice-01.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`${items.length} item`);
