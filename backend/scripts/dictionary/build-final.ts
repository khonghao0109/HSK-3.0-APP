import * as fs from 'fs';
import * as path from 'path';

type Word = {
  hanzi: string;
  traditional: string;
  pinyin: string;
  meaning_en: string[];
  is_pure: boolean;
};

type WordLevel = {
  hanzi: string;
  level: string;
};

const wordsPath = path.join(__dirname, 'parsed/words.json');
const levelsPath = path.join(__dirname, 'parsed/word_levels.json');
const outputPath = path.join(__dirname, 'parsed/final_words.json');

function loadJSON<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

function main() {
  const words = loadJSON<Word[]>(wordsPath);
  const levels = loadJSON<WordLevel[]>(levelsPath);

  // tạo map tra nhanh O(1)
  const levelMap = new Map<string, string>();
  for (const item of levels) {
    levelMap.set(item.hanzi, item.level);
  }

  const final = words.map((word) => {
    return {
      ...word,
      level: levelMap.get(word.hanzi) || null,
    };
  });

  fs.writeFileSync(outputPath, JSON.stringify(final, null, 2), 'utf-8');

  console.log('✅ Final JSON created');
  console.log('📊 Total words:', final.length);

  const hasLevel = final.filter((w) => w.level).length;
  console.log('📊 Words with HSK level:', hasLevel);
}

main();
