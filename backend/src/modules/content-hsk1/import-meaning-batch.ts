import type { Prisma, PrismaClient } from '@prisma/client';

import { normalizeMeaning } from '../../common/utils/normalize-meaning';
import {
  comparablePinyin,
  type Hsk1Lexicon,
  type MeaningBatch,
  meaningBatchContentSha256,
  validateMeaningBatch,
} from './meaning-batch';

/**
 * Nạp / gỡ một lô nghĩa tiếng Việt (P1–P2, PO 17/11/2026).
 * - Chỉ nạp lô `approved` có người duyệt, ngày duyệt, hash khớp nội dung.
 * - Mỗi lô một `DataSource` (`notes` ghi người duyệt, ngày, hash, file).
 * - Nghĩa tiếng Việt là dòng `WordMeaning` **mới** sau các dòng CC-CEDICT.
 * - `WordExample` ở `draft`.
 * - Rollback theo `dataSourceId`: xoá ví dụ rồi nghĩa của đúng lô đó.
 * - Chạy lại không tạo trùng; lô đã nạp mà nội dung khác ⇒ fail, phải rollback trước.
 */

export class MeaningImportError extends Error {}

export type MeaningImportPlan = {
  dataSourceCode: string;
  contentSha256: string;
  meaningsToCreate: number;
  meaningsExisting: number;
  examplesToCreate: number;
  examplesExisting: number;
};

type Db = PrismaClient | Prisma.TransactionClient;

function sourceNotes(
  batch: MeaningBatch,
  fileName: string,
  sha: string,
): string {
  return [
    batch.dataSource.notes,
    `Lô ${batch.batchId} (${fileName}), bài ${batch.lessons.join(', ')}.`,
    `Người duyệt: ${batch.review.reviewer}; ngày duyệt: ${batch.review.reviewedAt}; contentSha256: ${sha}.`,
  ].join('\n');
}

async function resolveWords(db: Db, batch: MeaningBatch, lexicon: Hsk1Lexicon) {
  const resolved: { wordId: number; entryIndex: number }[] = [];
  for (const [entryIndex, entry] of batch.entries.entries()) {
    const reading = lexicon.readings
      .get(entry.hanzi)
      ?.find(
        (r) => comparablePinyin(r.marked) === comparablePinyin(entry.pinyin),
      );
    const word = reading
      ? await db.word.findFirst({
          where: {
            hanzi: entry.hanzi,
            pinyin: reading.pinyin,
            deletedAt: null,
            wordLevels: { some: { level: { code: 'HSK1' } } },
          },
          select: { id: true },
        })
      : null;
    if (!word) {
      throw new MeaningImportError(
        `Không resolve được Word HSK1 (${entry.hanzi}, ${entry.pinyin}); không tự tạo Word (TL-219)`,
      );
    }
    resolved.push({ wordId: word.id, entryIndex });
  }
  return resolved;
}

export async function importMeaningBatch(
  prisma: PrismaClient,
  batch: MeaningBatch,
  lexicon: Hsk1Lexicon,
  options: { fileName: string; dryRun: boolean },
): Promise<MeaningImportPlan> {
  const issues = validateMeaningBatch(batch, lexicon);
  if (issues.length > 0) {
    throw new MeaningImportError(
      `Lô không hợp lệ:\n${issues.map((i) => `${i.code} ${i.path} ${i.message}`).join('\n')}`,
    );
  }
  if (batch.review.status !== 'approved') {
    throw new MeaningImportError(
      `Lô ${batch.batchId} chưa được duyệt (review.status = ${batch.review.status})`,
    );
  }
  const sha = meaningBatchContentSha256(batch);

  return prisma.$transaction(async (tx) => {
    const existingSource = await tx.dataSource.findUnique({
      where: { code: batch.dataSource.code },
    });
    if (
      existingSource &&
      existingSource.contentHash !== null &&
      existingSource.contentHash !== sha
    ) {
      throw new MeaningImportError(
        `DataSource ${batch.dataSource.code} đã nạp với nội dung khác; rollback lô trước khi nạp lại`,
      );
    }
    const words = await resolveWords(tx, batch, lexicon);
    if (
      existingSource &&
      existingSource.contentHash === null &&
      !options.dryRun
    ) {
      // Lô đã rollback: gắn lại hash và người duyệt của bản nạp mới.
      await tx.dataSource.update({
        where: { id: existingSource.id },
        data: {
          contentHash: sha,
          importedAt: new Date(),
          notes: `${existingSource.notes ?? ''}\n${sourceNotes(batch, options.fileName, sha)}`,
        },
      });
    }
    const source =
      existingSource ??
      (options.dryRun
        ? null
        : await tx.dataSource.create({
            data: {
              code: batch.dataSource.code,
              name: batch.dataSource.name,
              version: batch.dataSource.version,
              license: batch.dataSource.license,
              attribution: batch.dataSource.attribution,
              notes: sourceNotes(batch, options.fileName, sha),
              contentHash: sha,
              importedAt: new Date(),
            },
          }));
    const plan: MeaningImportPlan = {
      dataSourceCode: batch.dataSource.code,
      contentSha256: sha,
      meaningsToCreate: 0,
      meaningsExisting: 0,
      examplesToCreate: 0,
      examplesExisting: 0,
    };

    for (const { wordId, entryIndex } of words) {
      const entry = batch.entries[entryIndex];
      let meaning = source
        ? await tx.wordMeaning.findFirst({
            where: { wordId, dataSourceId: source.id },
            select: { id: true },
          })
        : null;
      if (meaning) {
        plan.meaningsExisting += 1;
      } else {
        plan.meaningsToCreate += 1;
        if (source) {
          const last = await tx.wordMeaning.aggregate({
            where: { wordId },
            _max: { meaningOrder: true },
          });
          meaning = await tx.wordMeaning.create({
            data: {
              wordId,
              meaningOrder: (last._max.meaningOrder ?? 0) + 1,
              meaningVi: entry.meaningVi,
              meaningViNormalized: normalizeMeaning(entry.meaningVi),
              partOfSpeech: entry.partOfSpeech,
              dataSourceId: source.id,
            },
            select: { id: true },
          });
        }
      }
      for (const [orderIndex, example] of entry.examples.entries()) {
        const existing = source
          ? await tx.wordExample.findFirst({
              where: { wordId, dataSourceId: source.id, hanzi: example.hanzi },
              select: { id: true },
            })
          : null;
        if (existing) {
          plan.examplesExisting += 1;
          continue;
        }
        plan.examplesToCreate += 1;
        if (source && meaning) {
          await tx.wordExample.create({
            data: {
              wordId,
              meaningId: meaning.id,
              orderIndex,
              hanzi: example.hanzi,
              pinyin: example.pinyin,
              translationVi: example.translationVi,
              dataSourceId: source.id,
              status: 'draft',
            },
          });
        }
      }
    }
    return plan;
  });
}

export async function rollbackMeaningBatch(
  prisma: PrismaClient,
  dataSourceCode: string,
  options: { dryRun: boolean },
): Promise<{ examples: number; meanings: number }> {
  return prisma.$transaction(async (tx) => {
    const source = await tx.dataSource.findUnique({
      where: { code: dataSourceCode },
    });
    if (!source)
      throw new MeaningImportError(`Không có DataSource ${dataSourceCode}`);
    const where = { dataSourceId: source.id };
    if (options.dryRun) {
      return {
        examples: await tx.wordExample.count({ where }),
        meanings: await tx.wordMeaning.count({ where }),
      };
    }
    const examples = await tx.wordExample.deleteMany({ where });
    const meanings = await tx.wordMeaning.deleteMany({ where });
    // Giữ DataSource để còn dấu vết; bỏ contentHash để lô sửa có thể nạp lại.
    await tx.dataSource.update({
      where: { id: source.id },
      data: {
        contentHash: null,
        notes: `${source.notes ?? ''}\nRollback ${new Date().toISOString()}: gỡ ${examples.count} ví dụ, ${meanings.count} nghĩa.`,
      },
    });
    return { examples: examples.count, meanings: meanings.count };
  });
}
