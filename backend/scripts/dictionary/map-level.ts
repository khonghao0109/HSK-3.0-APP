import * as fs from 'fs';
import * as path from 'path';

const rawDir = path.join(__dirname, 'raw');
const parsedDir = path.join(__dirname, 'parsed');
const mergedHSKPath = path.join(parsedDir, 'hsk.json');

function mergeHSKFiles() {
  const files = fs.readdirSync(rawDir);

  const hskFiles = files.filter(
    (f) => f.startsWith('hsk') && f.endsWith('.json'),
  );

  const result: HSKItem[] = [];

  for (const file of hskFiles) {
    const fullPath = path.join(rawDir, file);
    const data = loadJSON<HSKItem[]>(fullPath);

    for (const item of data) {
      result.push({
        hanzi: item.hanzi.trim(),
        level: item.level,
      });
    }
  }

  // remove duplicate (quan trọng)
  const uniqueMap = new Map<string, string>();

  for (const item of result) {
    if (!uniqueMap.has(item.hanzi)) {
      uniqueMap.set(item.hanzi, item.level);
    }
  }

  const merged: HSKItem[] = [];

  for (const [hanzi, level] of uniqueMap.entries()) {
    merged.push({ hanzi, level });
  }

  fs.writeFileSync(mergedHSKPath, JSON.stringify(merged, null, 2), 'utf-8');

  console.log('✅ HSK merged:', merged.length);
}
type Word = {
  hanzi: string;
  pinyin: string;
};

type HSKItem = {
  hanzi: string;
  level: string;
};

type WordLevel = {
  hanzi: string;
  level: string;
};

// ===== PATH =====
const wordsPath = path.join(__dirname, 'parsed/words.json');
const hskPath = path.join(__dirname, 'parsed/hsk.json');
const outputPath = path.join(__dirname, 'parsed/word_levels.json');

// ===== LOAD JSON SAFE =====
function loadJSON<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

// ===== MAIN =====
function main() {
  mergeHSKFiles();
  const words = loadJSON<Word[]>(wordsPath);
  const hskList = loadJSON<HSKItem[]>(hskPath);

  // Map hanzi -> level
  const hskMap = new Map<string, string>();

  for (const item of hskList) {
    hskMap.set(item.hanzi, item.level);
  }

  const result: WordLevel[] = [];

  for (const word of words) {
    const level = hskMap.get(word.hanzi);

    if (level) {
      result.push({
        hanzi: word.hanzi,
        level,
      });
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');

  console.log('✅ Mapping completed');
  console.log('📊 Total mapped:', result.length);
}

main();
