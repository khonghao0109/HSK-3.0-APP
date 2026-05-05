import * as fs from 'fs';
import * as path from 'path';

const RAW_DIR = path.join(process.cwd(), 'scripts/dictionary/raw');

const FILES = [
  { file: 'HSK 1.txt', level: 'HSK1', output: 'hsk1.json' },
  { file: 'HSK 2.txt', level: 'HSK2', output: 'hsk2.json' },
  { file: 'HSK 3.txt', level: 'HSK3', output: 'hsk3.json' },
  { file: 'HSK 4.txt', level: 'HSK4', output: 'hsk4.json' },
  { file: 'HSK 5.txt', level: 'HSK5', output: 'hsk5.json' },
  { file: 'HSK 6.txt', level: 'HSK6', output: 'hsk6.json' },
  { file: 'HSK 7-9.txt', level: 'HSK7-9', output: 'hsk7-9.json' },
];

function convertFile(filePath: string, level: string) {
  const content = fs.readFileSync(filePath, 'utf-8');

  const words = content
    .split('\n')
    .map((line: string) => line.trim())
    .filter((line: string) => line.length > 0);

  return words.map((word: string) => ({
    hanzi: word,
    level,
  }));
}

function main() {
  FILES.forEach(({ file, level, output }) => {
    const inputPath = path.join(RAW_DIR, file);
    const outputPath = path.join(RAW_DIR, output);

    if (!fs.existsSync(inputPath)) {
      console.log(`❌ Missing file: ${file}`);
      return;
    }

    const data = convertFile(inputPath, level);

    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');

    console.log(`✅ Converted ${file} → ${output}`);
  });
}

main();
