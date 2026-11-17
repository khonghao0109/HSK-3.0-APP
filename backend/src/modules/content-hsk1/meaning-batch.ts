import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { canonicalJson } from '../../common/utils/canonical-json';
import { toneMarkedPinyin } from '../content-pilot/pilot-content.validator';

/**
 * M1.2a/M1.2b (PO 17/11/2026, P1–P2): lô nghĩa tiếng Việt + câu ví dụ HSK1.
 *
 * Một file `backend/content/hsk1/meanings/batch-NN.json` là một lô; trạng thái
 * duyệt nằm trong `review` của file (P1, không migration). Người duyệt điền
 * `reviewer`, `reviewedAt` và `contentSha256` (= `meaningBatchContentSha256`)
 * khi duyệt, nên bản duyệt gắn chặt với nội dung. Module thuần, chỉ đọc file
 * đã commit trong repo.
 */

export const MEANING_BATCH_LIMITS = {
  maxMeaningLength: 200,
  maxExampleHan: 12,
  maxTranslationLength: 300,
  maxExamples: 3,
} as const;

export const PARTS_OF_SPEECH = [
  'danh từ',
  'danh từ riêng',
  'động từ',
  'tính từ',
  'phó từ',
  'đại từ',
  'số từ',
  'lượng từ',
  'giới từ',
  'liên từ',
  'trợ từ',
  'thán từ',
  'cụm từ',
  'tiền tố',
  'hậu tố',
] as const;

export type MeaningBatchExample = {
  hanzi: string;
  pinyin: string;
  translationVi: string;
};
export type MeaningBatchEntry = {
  hanzi: string;
  pinyin: string;
  partOfSpeech: string;
  meaningVi: string;
  examples: MeaningBatchExample[];
};
export type MeaningBatch = {
  schemaVersion: 1;
  batchId: string;
  lessons: number[];
  dataSource: {
    code: string;
    name: string;
    version: string;
    license: string;
    attribution: string;
    notes: string;
  };
  review: {
    /** `pending`, `changes_requested` hoặc `approved`; để `string` để không đổi thứ tự enum Swagger (xem PinSwaggerEnumOrder). */
    status: string;
    reviewer: string | null;
    reviewedAt: string | null;
    contentSha256: string | null;
    notes: string[];
  };
  properNames: { hanzi: string; pinyin: string; note: string }[];
  entries: MeaningBatchEntry[];
};

export type MeaningBatchIssue = { code: string; path: string; message: string };

export type Hsk1Lexicon = {
  /** hanzi → các cách đọc HSK1 (pinyin bỏ dấu như `Word.pinyin`, pinyin có dấu). */
  readings: Map<string, { pinyin: string; marked: string }[]>;
  /** Mọi âm tiết pinyin bỏ dấu có trong `final_words.json` (để đếm âm tiết). */
  syllables: Set<string>;
};

export function loadHsk1Lexicon(backendRoot: string): Hsk1Lexicon {
  const rows = JSON.parse(
    readFileSync(
      join(backendRoot, 'scripts/dictionary/parsed/final_words.json'),
      'utf8',
    ),
  ) as {
    hanzi: string;
    pinyin: string;
    pinyin_tone?: string | null;
    level: string | null;
  }[];
  const readings = new Map<string, { pinyin: string; marked: string }[]>();
  const syllables = new Set<string>();
  for (const row of rows) {
    // Chỉ âm tiết Hán có số thanh: loại chữ Latin trong mục CC-CEDICT (`T恤` → `T`).
    for (const syllable of (row.pinyin_tone ?? '')
      .toLowerCase()
      .split(/\s+/u)) {
      const match = /^([a-z:]+)[1-5]$/u.exec(syllable);
      if (match) syllables.add(match[1].replace(/u:/gu, 'v'));
    }
    if (row.level !== 'HSK1' || !row.pinyin_tone) continue;
    const bucket = readings.get(row.hanzi) ?? [];
    bucket.push({
      pinyin: row.pinyin,
      marked: toneMarkedPinyin(row.pinyin_tone),
    });
    readings.set(row.hanzi, bucket);
  }
  return { readings, syllables };
}

/** Hash nội dung được duyệt (không gồm `review`). */
export function meaningBatchContentSha256(batch: MeaningBatch): string {
  const { batchId, lessons, dataSource, properNames, entries } = batch;
  return createHash('sha256')
    .update(
      canonicalJson({ batchId, lessons, dataSource, properNames, entries }),
    )
    .digest('hex');
}

/**
 * PO 17/11/2026 (PR #10): câu ví dụ của lô được `published` khi và chỉ khi lô
 * `approved` có người duyệt, ngày duyệt hợp lệ và `contentSha256` khớp nội dung;
 * mọi trường hợp khác là `draft`.
 */
export function exampleStatusFor(batch: MeaningBatch): 'published' | 'draft' {
  const review = batch.review;
  return review?.status === 'approved' &&
    Boolean(review.reviewer?.trim()) &&
    /^\d{4}-\d{2}-\d{2}$/u.test(review.reviewedAt ?? '') &&
    review.contentSha256 === meaningBatchContentSha256(batch)
    ? 'published'
    : 'draft';
}

const HAN = /\p{Script=Han}/u;
const PUNCT = /[\s\p{P}]/u;

/** So pinyin có dấu: NFC, chữ thường, bỏ khoảng trắng và dấu nháy. */
export function comparablePinyin(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s'’-]/gu, '');
}

/** Chữ Hán của câu, bỏ dấu câu và khoảng trắng; `null` khi có ký tự lạ (chữ số, Latin…). */
export function hanOnly(sentence: string): string | null {
  let out = '';
  for (const char of sentence) {
    if (HAN.test(char)) out += char;
    else if (!PUNCT.test(char)) return null;
  }
  return out;
}

/** Tách câu thành các từ trong `vocabulary` (quy hoạch động, ưu tiên từ dài). */
export function segmentWords(
  han: string,
  vocabulary: ReadonlySet<string>,
): string[] | null {
  const chars = [...han];
  const best = Array.from(
    { length: chars.length + 1 },
    (): string[] | null => null,
  );
  best[0] = [];
  const at = (start: number, end: number) => chars.slice(start, end).join('');
  for (let end = 1; end <= chars.length; end += 1) {
    for (let start = 0; start < end; start += 1) {
      const prefix = best[start];
      const word = at(start, end);
      if (prefix === null || !vocabulary.has(word)) continue;
      const candidate = [...prefix, word];
      if (
        best[end] === null ||
        candidate.length < (best[end] as string[]).length
      ) {
        best[end] = candidate;
      }
    }
  }
  return best[chars.length];
}

/** Các số âm tiết có thể có của câu pinyin (mỗi cụm chữ cái tách theo bảng âm tiết). */
export function syllableCounts(
  pinyin: string,
  syllables: ReadonlySet<string>,
): Set<number> {
  const letters = pinyin
    .normalize('NFD')
    .replace(/[\u0300-\u0307\u0309-\u036f]/gu, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/ü/gu, 'v');
  let totals = new Set<number>([0]);
  for (const chunk of letters.split(/[^a-z]+/u).filter(Boolean)) {
    const counts: Set<number>[] = Array.from(
      { length: chunk.length + 1 },
      () => new Set(),
    );
    counts[0].add(0);
    for (let end = 1; end <= chunk.length; end += 1) {
      for (let start = Math.max(0, end - 6); start < end; start += 1) {
        if (!syllables.has(chunk.slice(start, end))) continue;
        for (const n of counts[start]) counts[end].add(n + 1);
      }
    }
    const next = new Set<number>();
    for (const a of totals)
      for (const b of counts[chunk.length]) next.add(a + b);
    totals = next;
  }
  return totals;
}

export function validateMeaningBatch(
  batch: MeaningBatch,
  lexicon: Hsk1Lexicon,
  seenExamples: ReadonlySet<string> = new Set(),
): MeaningBatchIssue[] {
  const issues: MeaningBatchIssue[] = [];
  const add = (code: string, path: string, message: string) =>
    issues.push({ code, path, message });
  const number = /^hsk1-vi-(\d{2})$/u.exec(batch.batchId ?? '');
  if (batch.schemaVersion !== 1)
    add('schema_invalid', 'schemaVersion', 'phải là 1');
  if (!number) add('batch_id_invalid', 'batchId', '= hsk1-vi-NN');
  else if (batch.dataSource?.code !== `HSK30_VI_HSK1_B${number[1]}`) {
    add(
      'data_source_code_invalid',
      'dataSource.code',
      `phải là HSK30_VI_HSK1_B${number[1]}`,
    );
  }
  for (const key of [
    'name',
    'version',
    'license',
    'attribution',
    'notes',
  ] as const) {
    if (!batch.dataSource?.[key]?.trim())
      add('data_source_field_missing', `dataSource.${key}`, 'bắt buộc');
  }
  const review = batch.review;
  if (
    !review ||
    !['approved', 'changes_requested', 'pending'].includes(review.status)
  ) {
    add(
      'review_invalid',
      'review.status',
      'approved | changes_requested | pending',
    );
  } else if (review.status === 'approved') {
    if (!review.reviewer?.trim())
      add(
        'review_reviewer_missing',
        'review.reviewer',
        'lô approved phải có người duyệt',
      );
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(review.reviewedAt ?? '')) {
      add('review_date_missing', 'review.reviewedAt', 'YYYY-MM-DD');
    }
    if (review.contentSha256 !== meaningBatchContentSha256(batch)) {
      add(
        'review_hash_mismatch',
        'review.contentSha256',
        'nội dung đã đổi sau khi duyệt hoặc hash sai',
      );
    }
  }

  const vocabulary = new Set<string>(lexicon.readings.keys());
  for (const [index, name] of (batch.properNames ?? []).entries()) {
    const han = hanOnly(name.hanzi);
    if (!han || !segmentWords(han, vocabulary)) {
      add(
        'proper_name_not_hsk1',
        `properNames[${index}]`,
        `${name.hanzi} phải ghép từ từ HSK1`,
      );
    }
    if (!name.note?.trim())
      add(
        'proper_name_note_missing',
        `properNames[${index}].note`,
        'ghi rõ là tên riêng',
      );
    vocabulary.add(name.hanzi);
  }

  const seenWords = new Set<string>();
  const seen = new Set(seenExamples);
  for (const [index, entry] of (batch.entries ?? []).entries()) {
    const at = `entries[${index}]`;
    const reading = lexicon.readings
      .get(entry.hanzi)
      ?.find(
        (r) => comparablePinyin(r.marked) === comparablePinyin(entry.pinyin),
      );
    if (!reading) {
      add(
        'word_not_found',
        at,
        `(${entry.hanzi}, ${entry.pinyin}) không phải cách đọc HSK1 trong Word`,
      );
    }
    const key = `${entry.hanzi}\u0000${comparablePinyin(entry.pinyin)}`;
    if (seenWords.has(key))
      add('word_duplicate', at, `${entry.hanzi} lặp trong lô`);
    seenWords.add(key);

    // Từ đa từ loại ghi "danh từ, động từ" (PO 17/11/2026).
    const parts = (entry.partOfSpeech ?? '').split(', ');
    if (
      new Set(parts).size !== parts.length ||
      !parts.every((part) =>
        (PARTS_OF_SPEECH as readonly string[]).includes(part),
      )
    ) {
      add('part_of_speech_invalid', `${at}.partOfSpeech`, entry.partOfSpeech);
    }
    const meaning = entry.meaningVi ?? '';
    if (!meaning.trim() || meaning !== meaning.trim())
      add('meaning_blank', `${at}.meaningVi`, 'rỗng hoặc thừa khoảng trắng');
    if (meaning.length > MEANING_BATCH_LIMITS.maxMeaningLength)
      add(
        'meaning_too_long',
        `${at}.meaningVi`,
        `> ${MEANING_BATCH_LIMITS.maxMeaningLength}`,
      );
    if (/[.。]$/u.test(meaning))
      add('meaning_trailing_period', `${at}.meaningVi`, 'không dấu chấm cuối');
    if (/^\p{Lu}/u.test(meaning) && entry.partOfSpeech !== 'danh từ riêng')
      add('meaning_capitalized', `${at}.meaningVi`, 'không viết hoa đầu');
    if (
      entry.partOfSpeech === 'lượng từ' &&
      !meaning.startsWith('(lượng từ)')
    ) {
      add(
        'measure_word_label',
        `${at}.meaningVi`,
        'lượng từ phải bắt đầu bằng "(lượng từ)"',
      );
    }

    const examples = entry.examples ?? [];
    if (
      examples.length < 1 ||
      examples.length > MEANING_BATCH_LIMITS.maxExamples
    ) {
      add(
        'example_count',
        `${at}.examples`,
        `cần 1–${MEANING_BATCH_LIMITS.maxExamples} câu`,
      );
    }
    for (const [e, example] of examples.entries()) {
      const ep = `${at}.examples[${e}]`;
      const han = hanOnly(example.hanzi ?? '');
      if (!han) {
        add('example_invalid_chars', `${ep}.hanzi`, 'chỉ chữ Hán và dấu câu');
        continue;
      }
      if ([...han].length > MEANING_BATCH_LIMITS.maxExampleHan) {
        add(
          'example_too_long',
          `${ep}.hanzi`,
          `> ${MEANING_BATCH_LIMITS.maxExampleHan} chữ Hán`,
        );
      }
      if (!example.hanzi.includes(entry.hanzi))
        add('example_missing_word', `${ep}.hanzi`, `không chứa ${entry.hanzi}`);
      if (!segmentWords(han, vocabulary))
        add(
          'example_not_hsk1',
          `${ep}.hanzi`,
          `${example.hanzi} có từ ngoài HSK1`,
        );
      if (
        !syllableCounts(example.pinyin ?? '', lexicon.syllables).has(
          [...han].length,
        )
      ) {
        add(
          'example_pinyin_count',
          `${ep}.pinyin`,
          `số âm tiết không khớp ${[...han].length} chữ Hán`,
        );
      }
      if (!/[\u0300-\u036f]/u.test((example.pinyin ?? '').normalize('NFD'))) {
        add('example_pinyin_no_tone', `${ep}.pinyin`, 'thiếu dấu thanh');
      }
      const vi = example.translationVi ?? '';
      if (!vi.trim() || vi.length > MEANING_BATCH_LIMITS.maxTranslationLength) {
        add(
          'example_translation_invalid',
          `${ep}.translationVi`,
          'rỗng hoặc quá dài',
        );
      }
      if (seen.has(han))
        add(
          'example_duplicate',
          `${ep}.hanzi`,
          `${example.hanzi} trùng câu khác`,
        );
      seen.add(han);
    }
  }
  return issues;
}

/** Câu ví dụ (chỉ chữ Hán) của một lô, để kiểm trùng giữa các lô. */
export function batchExampleKeys(batch: MeaningBatch): string[] {
  return batch.entries.flatMap((entry) =>
    entry.examples.map((example) => hanOnly(example.hanzi) ?? example.hanzi),
  );
}
