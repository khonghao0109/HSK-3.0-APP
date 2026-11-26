/// <reference types="jest" />

import { PrismaClient } from '@prisma/client';

import {
  importHanziStrokes,
  MAKEMEAHANZI_SOURCE_CODE,
} from '../src/modules/dictionary-data/hanzi-strokes';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

/** Q357: nạp nét chữ Make Me a Hanzi vào `Character` (idempotent, tôn trọng nguồn khác). */
describe('Hanzi stroke import (Q357)', () => {
  const prisma = new PrismaClient();
  const chars = ['龘', '靐', '齉'];
  const row = (character: string, strokes: number) => ({
    character,
    strokes: Array.from({ length: strokes }, (_, i) => `M ${i} 0 L ${i} 9 Z`),
    medians: Array.from({ length: strokes }, (_, i): [number, number][] => [
      [i, 0],
      [i, 9],
    ]),
  });

  beforeAll(async () => {
    assertDisposableTestDatabase();
    await prisma.character.deleteMany({ where: { hanzi: { in: chars } } });
  });

  afterAll(async () => {
    try {
      await prisma.character.deleteMany({ where: { hanzi: { in: chars } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it('has the data source from the migration', async () => {
    const source = await prisma.dataSource.findUnique({
      where: { code: MAKEMEAHANZI_SOURCE_CODE },
    });
    expect(source).toMatchObject({
      license: 'Arphic Public License',
      referenceUrl: 'https://github.com/skishore/makemeahanzi',
    });
  });

  it('creates, then is idempotent, updates changed rows and skips other sources', async () => {
    const other = await prisma.dataSource.findFirstOrThrow({
      where: { code: { not: MAKEMEAHANZI_SOURCE_CODE } },
      select: { id: true },
    });
    await prisma.character.create({
      data: { hanzi: '齉', strokeCount: 1, dataSourceId: other.id },
    });

    expect(
      await importHanziStrokes(prisma, [
        row('龘', 3),
        row('靐', 2),
        row('齉', 4),
      ]),
    ).toEqual({
      created: 2,
      updated: 0,
      unchanged: 0,
      skippedOtherSource: ['齉'],
    });
    expect(
      await importHanziStrokes(prisma, [row('龘', 3), row('靐', 2)]),
    ).toEqual({ created: 0, updated: 0, unchanged: 2, skippedOtherSource: [] });
    expect(await importHanziStrokes(prisma, [row('龘', 5)])).toMatchObject({
      updated: 1,
    });

    const stored = await prisma.character.findUniqueOrThrow({
      where: { hanzi: '龘' },
      select: { strokeCount: true, strokeData: true, pinyin: true },
    });
    expect(stored.strokeCount).toBe(5);
    expect(stored.pinyin).toBeNull();
    expect((stored.strokeData as { strokes: string[] }).strokes).toHaveLength(
      5,
    );
    expect(
      (await prisma.character.findUniqueOrThrow({ where: { hanzi: '齉' } }))
        .strokeCount,
    ).toBe(1);
  });
});
