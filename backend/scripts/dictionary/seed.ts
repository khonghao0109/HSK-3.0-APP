import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

type FinalWord = {
  hanzi: string;
  pinyin: string;
  pinyin_tone?: string;
  traditional?: string;
  is_pure: boolean;
  meaning_en: string[];
  level: string | null;
};

const BATCH_SIZE = 1000;
const inputPath = path.join(__dirname, 'parsed/final_words.json');

async function main() {
  console.log('🚀 Start seeding...');

  const raw = fs.readFileSync(inputPath, 'utf-8');
  const words: FinalWord[] = JSON.parse(raw) as FinalWord[];

  // =========================
  // 1. SEED LEVEL
  // =========================
  const levels = ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6', 'HSK7-9'];
  const levelMap = new Map<string, number>();

  for (const name of levels) {
    const level = await prisma.level.upsert({
      where: { name },
      update: {},
      create: {
        name,
        orderIndex: levels.indexOf(name) + 1,
      },
    });
    levelMap.set(name, level.id);
  }

  console.log('✅ Levels ready');

  // =========================
  // 2. INSERT WORD (batch)
  // =========================
  for (let i = 0; i < words.length; i += BATCH_SIZE) {
    const batch = words.slice(i, i + BATCH_SIZE);

    await prisma.word.createMany({
      data: batch.map((w) => ({
        hanzi: w.hanzi,
        pinyin: w.pinyin,
        pinyinTone: w.pinyin_tone ?? null,
        traditional: w.traditional,
        isPure: w.is_pure,
      })),
      skipDuplicates: true,
    });

    console.log(`📦 Word batch ${i} → ${i + BATCH_SIZE}`);
  }

  console.log('✅ Words inserted');

  // =========================
  // 3. WORD MAP — FIX BUG
  // =========================
  // BUG CŨ: chỉ select { hanzi } rồi dùng hanzi làm key
  //         → mất các từ đồng âm dị nghĩa (同音字) như 行 (háng / xíng)
  // FIX:    select thêm pinyin, dùng composite key "hanzi-pinyin"
  const dbWords = await prisma.word.findMany({
    select: { id: true, hanzi: true, pinyin: true }, // ← thêm pinyin
  });

  const wordMap = new Map<string, number>(); // key: "hanzi-pinyin"

  for (const w of dbWords) {
    const key = `${w.hanzi}-${w.pinyin}`;
    wordMap.set(key, w.id); // không cần check has() vì key là unique
  }

  console.log('✅ Word map ready');

  // =========================
  // 4. PREPARE DATA
  // =========================
  const meaningsData: { wordId: number; meaningEn: string }[] = [];
  const levelsData: { wordId: number; levelId: number }[] = [];

  // Track (wordId, meaningEn) đã thêm để tránh duplicate meanings
  const addedMeanings = new Set<string>();

  for (const w of words) {
    // FIX: dùng composite key để lookup đúng word
    const key = `${w.hanzi}-${w.pinyin}`;
    const wordId = wordMap.get(key);

    if (!wordId) continue;

    // Meanings — deduplicate trong memory trước khi insert
    for (const m of w.meaning_en) {
      const meaningKey = `${wordId}-${m}`;
      if (!addedMeanings.has(meaningKey)) {
        addedMeanings.add(meaningKey);
        meaningsData.push({ wordId, meaningEn: m });
      }
    }

    // Levels
    if (w.level && levelMap.has(w.level)) {
      levelsData.push({
        wordId,
        levelId: levelMap.get(w.level)!,
      });
    }
  }

  // =========================
  // 5. INSERT MEANINGS
  // =========================
  for (let i = 0; i < meaningsData.length; i += BATCH_SIZE) {
    await prisma.wordMeaning.createMany({
      data: meaningsData.slice(i, i + BATCH_SIZE),
      skipDuplicates: true,
    });
    console.log(`📦 Meaning batch ${i} → ${i + BATCH_SIZE}`);
  }

  console.log('✅ Meanings inserted');

  // =========================
  // 6. INSERT WORD LEVELS
  // =========================
  for (let i = 0; i < levelsData.length; i += BATCH_SIZE) {
    await prisma.wordLevel.createMany({
      data: levelsData.slice(i, i + BATCH_SIZE),
      skipDuplicates: true,
    });
  }

  console.log('✅ Levels mapped');
  console.log('🎉 SEED COMPLETED');
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
