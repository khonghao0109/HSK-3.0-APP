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

/** `GET /dictionary/words/:id` (M2.6a); fields the screen does not read are dropped. */
export const dictionaryWordDetailSchema = z.object({
  id: z.number().int().positive(),
  hanzi: z.string(),
  traditional: z.string().nullable(),
  pinyin: z.string(),
  pinyinTone: z.string().nullable(),
  example: z.string().nullable(),
  meanings: z.array(meaningSchema.extend({ order: z.number().int() })),
  levels: z.array(z.object({ code: z.string(), name: z.string() })),
  sources: z.array(z.object({ name: z.string(), version: z.string() })),
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
