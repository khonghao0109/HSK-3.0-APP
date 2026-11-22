import { z } from 'zod';

import { backendEnvelope } from '@/lib/api/backend-envelope';

// Server-only (Zod): the client components import types from here, never values.

const meaningSchema = z.object({
  en: z.string().nullable(),
  vi: z.string().nullable(),
});

/** One row of `GET /dictionary?query=` (docs/api/api.md §A.5). */
export const dictionarySearchItemSchema = z.object({
  id: z.number().int().positive(),
  hanzi: z.string(),
  pinyin: z.string(),
  pinyinTone: z.string().nullable(),
  meanings: z.array(meaningSchema),
  level: z.string().nullable(),
});

const sourceSchema = z.object({ name: z.string(), version: z.string() });

/**
 * The M2.6a word fields; `word` of the review routes (A.7b) is this subset
 * and has no `audio`, `examples` or `related` (Q306).
 */
export const dictionaryWordBaseSchema = z.object({
  id: z.number().int().positive(),
  hanzi: z.string(),
  traditional: z.string().nullable(),
  pinyin: z.string(),
  pinyinTone: z.string().nullable(),
  example: z.string().nullable(),
  meanings: z.array(meaningSchema.extend({ order: z.number().int() })),
  levels: z.array(z.object({ code: z.string(), name: z.string() })),
  sources: z.array(sourceSchema),
});

/** `GET /dictionary/words/:id` (M2.6a, M3.4b); fields the screen does not read are dropped. */
export const dictionaryWordDetailSchema = dictionaryWordBaseSchema.extend({
  // Q304: always null for now; never a URL.
  audio: z
    .object({
      mediaId: z.number().int().positive(),
      mimeType: z.string().nullable(),
      duration: z.number().nullable(),
    })
    .nullable(),
  examples: z.array(
    z.object({
      hanzi: z.string(),
      pinyin: z.string().nullable(),
      vi: z.string().nullable(),
      en: z.string().nullable(),
      source: sourceSchema,
    }),
  ),
  related: z.array(dictionarySearchItemSchema),
});

export const dictionarySavedSchema = z.object({
  wordId: z.number().int().positive(),
  saved: z.boolean(),
});

export const backendDictionarySearchSchema = backendEnvelope(
  z.array(dictionarySearchItemSchema),
);
export const backendDictionaryWordSchema = backendEnvelope(
  dictionaryWordDetailSchema,
);
export const backendDictionarySavedSchema = backendEnvelope(
  dictionarySavedSchema,
);

export type DictionarySearchItem = z.output<typeof dictionarySearchItemSchema>;
export type DictionaryWordDetail = z.output<typeof dictionaryWordDetailSchema>;

const pointSchema = z.tuple([z.number(), z.number()]);

/** `GET /dictionary/characters/strokes?hanzi=` (G2d): Make Me a Hanzi data. */
export const dictionaryStrokesSchema = z.object({
  characters: z.array(
    z.object({
      hanzi: z.string(),
      strokeCount: z.number().int().nullable(),
      strokes: z.array(z.string()).nullable(),
      medians: z.array(z.array(pointSchema)).nullable(),
      sourceCode: z.string().nullable(),
    }),
  ),
  sources: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      version: z.string(),
      license: z.string().nullable(),
      attribution: z.string().nullable(),
      referenceUrl: z.string().nullable(),
    }),
  ),
});

export const backendDictionaryStrokesSchema = backendEnvelope(
  dictionaryStrokesSchema,
);
