import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { normalizePinyin } from '../../src/common/utils/normalize-pinyin';

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

const LEVELS = [
  { name: 'HSK1', code: 'HSK1', minBand: 1, maxBand: 1 },
  { name: 'HSK2', code: 'HSK2', minBand: 2, maxBand: 2 },
  { name: 'HSK3', code: 'HSK3', minBand: 3, maxBand: 3 },
  { name: 'HSK4', code: 'HSK4', minBand: 4, maxBand: 4 },
  { name: 'HSK5', code: 'HSK5', minBand: 5, maxBand: 5 },
  { name: 'HSK6', code: 'HSK6', minBand: 6, maxBand: 6 },
  { name: 'HSK7-9', code: 'HSK7_9', minBand: 7, maxBand: 9 },
] as const;

async function main() {
  console.log('🚀 Start seeding...');

  const raw = fs.readFileSync(inputPath, 'utf-8');
  const words: FinalWord[] = JSON.parse(raw) as FinalWord[];

  // =========================
  // 1. SEED LEVEL
  // =========================
  const levelMap = new Map<string, number>();
  const levelSourceMap = new Map<string, number>();

  for (const [index, levelDefinition] of LEVELS.entries()) {
    const dataSource = await prisma.dataSource.findUnique({
      where: { code: `HSK_WORD_LIST_${levelDefinition.code}` },
      select: { id: true },
    });
    const level = await prisma.level.upsert({
      where: { name: levelDefinition.name },
      update: {
        code: levelDefinition.code,
        minBand: levelDefinition.minBand,
        maxBand: levelDefinition.maxBand,
        curriculumVersion: 'HSK_3_0',
        dataSourceId: dataSource?.id,
      },
      create: {
        ...levelDefinition,
        orderIndex: index + 1,
        curriculumVersion: 'HSK_3_0',
        status: 'published',
        publishedAt: new Date(),
        dataSourceId: dataSource?.id,
      },
    });
    levelMap.set(levelDefinition.name, level.id);
    if (dataSource) {
      levelSourceMap.set(levelDefinition.name, dataSource.id);
    }
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
        pinyinNormalized: normalizePinyin(w.pinyin),
        pinyinTone: w.pinyin_tone ?? null,
        traditional: w.traditional,
        isPure: w.is_pure,
        status: 'published',
        publishedAt: new Date(),
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
  const cedictSource = await prisma.dataSource.findUnique({
    where: { code: 'CC_CEDICT_2026_05_04' },
    select: { id: true },
  });
  const meaningsData: {
    wordId: number;
    meaningOrder: number;
    meaningEn: string;
    meaningEnNormalized: string;
    dataSourceId?: number;
  }[] = [];
  const levelsData: {
    wordId: number;
    levelId: number;
    dataSourceId?: number;
  }[] = [];

  // Track (wordId, meaningEn) đã thêm để tránh duplicate meanings
  const addedMeanings = new Set<string>();

  for (const w of words) {
    // FIX: dùng composite key để lookup đúng word
    const key = `${w.hanzi}-${w.pinyin}`;
    const wordId = wordMap.get(key);

    if (!wordId) continue;

    // Meanings — deduplicate trong memory trước khi insert
    for (const [meaningIndex, m] of w.meaning_en.entries()) {
      const meaningKey = `${wordId}-${m}`;
      if (!addedMeanings.has(meaningKey)) {
        addedMeanings.add(meaningKey);
        meaningsData.push({
          wordId,
          meaningOrder: meaningIndex + 1,
          meaningEn: m,
          meaningEnNormalized: m.trim().toLowerCase(),
          ...(cedictSource ? { dataSourceId: cedictSource.id } : {}),
        });
      }
    }

    // Levels
    if (w.level && levelMap.has(w.level)) {
      levelsData.push({
        wordId,
        levelId: levelMap.get(w.level)!,
        ...(levelSourceMap.has(w.level)
          ? { dataSourceId: levelSourceMap.get(w.level)! }
          : {}),
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

  if (cedictSource) {
    for (let i = 0; i < dbWords.length; i += BATCH_SIZE) {
      await prisma.wordSource.createMany({
        data: dbWords.slice(i, i + BATCH_SIZE).map((word) => ({
          wordId: word.id,
          dataSourceId: cedictSource.id,
          sourceKey: `${word.hanzi}:${word.pinyin}`,
          isPrimary: true,
        })),
        skipDuplicates: true,
      });
    }
  }

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
