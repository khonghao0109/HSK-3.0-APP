import { z } from 'zod';

import { backendEnvelope, backendPage } from '@/lib/api/backend-envelope';

/**
 * Contract của hai route BFF nhập bài tập (M5.1b2) — khớp response backend
 * A.9. Module kéo Zod nên CHỈ server code được import (service, route handler).
 */

export const exerciseImportDataSourceSchema = z.object({
  id: z.number().int().positive(),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  version: z.string().min(1).max(64),
});

export const exerciseImportDataSourceListSchema = backendPage(
  exerciseImportDataSourceSchema,
);

/** Một lỗi theo dòng; Z1 cắt 100 phần tử nhưng validate TỪNG phần tử. */
export const importRowErrorSchema = z.object({
  rowNumber: z.number().int().min(1),
  code: z.string().min(1).max(64),
  path: z.string().min(1).max(200),
});

/**
 * Z1: backend có thể trả hơn 100 lỗi (mỗi dòng có thể sai nhiều trường), nên
 * schema preview KHÔNG đặt `.max(100)`; route handler validate từng phần tử,
 * cắt 100 lỗi đầu (thứ tự backend) và thêm `errorsTotal`.
 */
const exerciseImportPreviewDataSchema = z.object({
  totalRows: z.number().int().min(0).max(100),
  validRows: z.number().int().min(0).max(100),
  invalidRows: z.number().int().min(0).max(100),
  errors: z.array(z.unknown()),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/u),
});

export const exerciseImportPreviewEnvelopeSchema = backendEnvelope(
  exerciseImportPreviewDataSchema,
);

const importedExerciseSchema = z.object({
  id: z.number().int().positive(),
  lessonId: z.number().int().positive(),
  topicId: z.number().int().positive().nullable(),
  type: z.string().min(1),
  prompt: z.string(),
  status: z.string().min(1),
  version: z.number().int().positive(),
  orderIndex: z.number().int().positive(),
  dataSourceId: z.number().int().positive().nullable(),
  sourceKey: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const exerciseImportCommitSchema = backendEnvelope(
  z.object({
    importJob: z.object({
      id: z.number().int().positive(),
      status: z.string().min(1),
      dataSourceId: z.number().int().positive(),
      fileName: z.string().min(1),
      totalRows: z.number().int().min(0),
      validRows: z.number().int().min(0),
      errorRows: z.number().int().min(0),
      importedRows: z.number().int().min(0),
    }),
    exercises: z.array(importedExerciseSchema),
    importedRows: z.number().int().min(0),
    idempotent: z.boolean(),
  }),
);
