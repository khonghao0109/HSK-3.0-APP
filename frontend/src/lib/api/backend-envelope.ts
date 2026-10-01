import { z } from 'zod';

/** List pagination; the backend sends it as `meta.pagination`. */
export const paginationSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

const envelopeMetaSchema = z.object({
  requestId: z.string().min(1),
  timestamp: z.string().min(1),
});

/**
 * Backend success envelope `{ success: true, data, meta }` (API §1). Resolves
 * to `{ success: true, data }`, the shape BFF routes return to the browser;
 * backend `meta` stays on the server.
 */
export function backendEnvelope<T extends z.ZodType>(data: T) {
  return z
    .object({ success: z.literal(true), data, meta: envelopeMetaSchema })
    .transform((envelope): { success: true; data: z.output<T> } => ({
      success: true,
      // `data` is required by the object schema above; zod cannot narrow a
      // generic key to "present" on its own.
      data: (envelope as { data: z.output<T> }).data,
    }));
}

/**
 * Backend paginated list envelope. Resolves to the BFF list shape
 * `{ success: true, data, meta: pagination }`.
 */
export function backendPage<T extends z.ZodType>(item: T) {
  return z
    .object({
      success: z.literal(true),
      data: z.array(item),
      meta: envelopeMetaSchema.extend({ pagination: paginationSchema }),
    })
    .transform((envelope) => ({
      success: true as const,
      data: envelope.data,
      meta: envelope.meta.pagination,
    }));
}
