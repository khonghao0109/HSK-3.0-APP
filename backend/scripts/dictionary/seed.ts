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

  // 🔥 FIX ESLINT (NO ANY)
  const raw = fs.readFileSync(inputPath, 'utf-8');
  const words: FinalWord[] = JSON.parse(raw) as FinalWord[];

  // =========================
  // 🔥 1. SEED LEVEL
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
  // 🔥 2. INSERT WORD
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
        // 👉 nếu schema có:
        // pinyinTone: w.pinyin_tone
      })),
      skipDuplicates: true,
    });

    console.log(`📦 Word batch ${i} -> ${i + BATCH_SIZE}`);
  }

  console.log('✅ Words inserted');

  // =========================
  // 🔥 3. WORD MAP (CRITICAL FIX)
  // =========================
  const dbWords = await prisma.word.findMany({
    select: { id: true, hanzi: true },
  });

  const wordMap = new Map<string, number>();

  for (const w of dbWords) {
    if (!wordMap.has(w.hanzi)) {
      wordMap.set(w.hanzi, w.id);
    }
  }

  console.log('✅ Word map ready');

  // =========================
  // 🔥 4. PREPARE DATA
  // =========================
  const meaningsData: { wordId: number; meaningEn: string }[] = [];
  const levelsData: { wordId: number; levelId: number }[] = [];

  for (const w of words) {
    const wordId = wordMap.get(w.hanzi);

    if (!wordId) continue;

    // meanings
    for (const m of w.meaning_en) {
      meaningsData.push({
        wordId,
        meaningEn: m,
      });
    }

    // levels
    if (w.level && levelMap.has(w.level)) {
      levelsData.push({
        wordId,
        levelId: levelMap.get(w.level)!,
      });
    }
  }

  // =========================
  // 🔥 5. INSERT MEANINGS
  // =========================
  for (let i = 0; i < meaningsData.length; i += BATCH_SIZE) {
    await prisma.wordMeaning.createMany({
      data: meaningsData.slice(i, i + BATCH_SIZE),
    });
  }

  console.log('✅ Meanings inserted');

  // =========================
  // 🔥 6. INSERT LEVELS
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
