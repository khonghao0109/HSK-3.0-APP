import * as fs from 'fs';
import * as path from 'path';

type Word = {
  hanzi: string;
  traditional: string;
  pinyin: string;
  meaning_en: string[];
  is_pure: boolean;
};

const inputPath = path.join(__dirname, 'raw/cedict_ts.u8');
const outputPath = path.join(__dirname, 'parsed/words.json');

function main() {
  const content = fs.readFileSync(inputPath, 'utf-8');
  const lines = content.split('\n');

  const wordMap = new Map<string, Word>(); // 🔥 thay vì array

  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^(\S+)\s+(\S+)\s+\[(.+?)\]\s+\/(.+)\//);
    if (!match) continue;

    const [, traditional, simplified, pinyinRaw, meaningRaw] = match;

    const pinyin = pinyinRaw.replace(/\d/g, '').toLowerCase().trim();

    const meanings = meaningRaw
      .split('/')
      .map((m: string) => m.trim())
      .filter(Boolean);

    const isPureChinese = /^[\u4e00-\u9fa5]+$/.test(simplified);

    const key = `${simplified}-${pinyin}`;

    const existing = wordMap.get(key);

    if (existing) {
      // merge meaning (tránh duplicate nghĩa)
      const merged = new Set([...existing.meaning_en, ...meanings]);
      existing.meaning_en = Array.from(merged);
    } else {
      wordMap.set(key, {
        hanzi: simplified,
        traditional,
        pinyin,
        meaning_en: meanings,
        is_pure: isPureChinese,
      });
    }
  }

  const result = Array.from(wordMap.values());

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');

  console.log('✅ Parse completed');
  console.log('📊 Total words:', result.length);
}

main();
