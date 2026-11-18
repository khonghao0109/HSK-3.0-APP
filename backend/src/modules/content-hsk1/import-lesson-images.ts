import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  Api,
  ExamImportError,
  isRecord,
  sha256,
  type ExamImportDeps,
} from './import-exam';

/**
 * Ảnh Bài 1 (Q350, PO 18/11/2026): nạp ảnh qua media ingestion (alt tiếng Việt)
 * rồi gán ảnh bìa và ảnh từ bằng `PUT /admin/cms/lessons/:id/images`.
 * Không ghi DB trực tiếp. Sổ `key → mediaId` giữ cho mỗi môi trường để nạp lại
 * không tạo media trùng; ingestion idempotent theo key nội dung + alt.
 */
export interface LessonImage {
  readonly key: string;
  readonly word: string | null;
  readonly altVi: string;
}
export interface LessonImagesFile {
  readonly images: readonly LessonImage[];
}
export interface LessonImagesLedger {
  media: Record<string, { id: number; sha256: string }>;
}
export interface LessonImagesOptions {
  readonly file: LessonImagesFile;
  readonly imagesDir: string;
  readonly ledgerPath: string;
  readonly lessonSlug: string;
  readonly dataSourceCode: string;
  readonly dryRun: boolean;
}

export interface LessonWordRow {
  readonly wordId: number;
  readonly hanzi: string;
}

/** Ảnh không có `word` là ảnh bìa; ảnh có `word` phải khớp đúng một từ của bài. */
export function planLessonImages(
  images: readonly LessonImage[],
  words: readonly LessonWordRow[],
) {
  const covers = images.filter((image) => image.word === null);
  if (covers.length > 1) {
    throw new ExamImportError('cover_ambiguous', 'Có hơn một ảnh bìa');
  }
  const wordImages = images.flatMap((image) => {
    if (image.word === null) return [];
    const matches = words.filter((row) => row.hanzi === image.word);
    if (matches.length !== 1) {
      throw new ExamImportError(
        'word_not_in_lesson',
        `Từ ${image.word} (${image.key}) khớp ${matches.length} từ trong bài`,
      );
    }
    return [{ key: image.key, wordId: matches[0].wordId }];
  });
  return { coverKey: covers[0]?.key ?? null, wordImages };
}

export async function importLessonImages(
  deps: ExamImportDeps,
  options: LessonImagesOptions,
) {
  const api = new Api(deps);
  const log = deps.log ?? (() => undefined);
  const ledger: LessonImagesLedger = existsSync(options.ledgerPath)
    ? (JSON.parse(
        readFileSync(options.ledgerPath, 'utf8'),
      ) as LessonImagesLedger)
    : { media: {} };

  const lessons = await api.request(
    'GET',
    `/admin/cms/lessons?search=${encodeURIComponent(options.lessonSlug)}&page=1&limit=100`,
  );
  const lessonRows: unknown[] = Array.isArray(lessons) ? lessons : [];
  const lesson = lessonRows.find(
    (row) => isRecord(row) && row.slug === options.lessonSlug,
  );
  if (!isRecord(lesson) || typeof lesson.id !== 'number') {
    throw new ExamImportError(
      'lesson_missing',
      `Không thấy bài ${options.lessonSlug}`,
    );
  }
  const detail = await api.request('GET', `/admin/cms/lessons/${lesson.id}`);
  const words = (
    isRecord(detail) && Array.isArray(detail.words) ? detail.words : []
  ).filter(
    (row): row is LessonWordRow =>
      isRecord(row) &&
      typeof row.wordId === 'number' &&
      typeof row.hanzi === 'string',
  );
  const plan = planLessonImages(options.file.images, words);

  const sources = await api.request(
    'GET',
    '/admin/cms/data-sources?eligibleFor=media&page=1&limit=100',
  );
  const sourceRows: unknown[] = Array.isArray(sources) ? sources : [];
  const source = sourceRows.find(
    (row) => isRecord(row) && row.code === options.dataSourceCode,
  );
  if (!isRecord(source) || typeof source.id !== 'number') {
    throw new ExamImportError(
      'data_source_missing',
      `Thiếu nguồn ${options.dataSourceCode}`,
    );
  }

  const mediaIds: Record<string, number> = {};
  let created = 0;
  for (const image of options.file.images) {
    const bytes = readFileSync(join(options.imagesDir, `${image.key}.png`));
    const digest = sha256(bytes);
    const known = ledger.media[image.key];
    if (known !== undefined && known.sha256 === digest) {
      mediaIds[image.key] = known.id;
      continue;
    }
    if (options.dryRun) {
      log(`dry-run: sẽ nạp ảnh ${image.key}`);
      continue;
    }
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
      `${image.key}.png`,
    );
    const data = await api.request(
      'POST',
      `/admin/cms/media/ingestions?dataSourceId=${source.id}&altText=${encodeURIComponent(image.altVi)}`,
      form,
      {
        'idempotency-key': `hsk1-lesson-${sha256(`${digest}\n${image.altVi}`).slice(0, 48)}`,
      },
    );
    const media = isRecord(data) && isRecord(data.media) ? data.media : null;
    if (media === null || typeof media.id !== 'number') {
      throw new ExamImportError(
        'invalid_api_response',
        'ingestion thiếu media.id',
      );
    }
    mediaIds[image.key] = media.id;
    ledger.media[image.key] = { id: media.id, sha256: digest };
    writeFileSync(options.ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
    created += 1;
  }
  if (options.dryRun) {
    return { lessonId: lesson.id, plan, mediaIds, created, assigned: false };
  }
  await api.request('PUT', `/admin/cms/lessons/${lesson.id}/images`, {
    ...(plan.coverKey === null
      ? {}
      : { coverImageId: mediaIds[plan.coverKey] }),
    wordImages: plan.wordImages.map(({ key, wordId }) => ({
      wordId,
      imageId: mediaIds[key],
    })),
  });
  return { lessonId: lesson.id, plan, mediaIds, created, assigned: true };
}
