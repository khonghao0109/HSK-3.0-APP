// M1.7b2 B2b: values the privacy panel (a client component) shares with the
// BFF. No Zod here (frontend/AGENTS.md, CSP).

/** One row of `GET /users/me/data-exports` (M1.7b1). */
export type DataExportItem = {
  id: number;
  /** `requested`, `processing`, `completed` or `failed` (DataExportJob). */
  status: string;
  createdAt: string;
  completedAt: string | null;
  /** 24 h after completion. */
  outputExpiresAt: string | null;
  downloadable: boolean;
};

/**
 * Backend codes the BFF passes on, because the page explains them, each with
 * the only status it comes with.
 */
export const DATA_EXPORT_CODES: ReadonlyMap<string, number> = new Map([
  ['EXPORT_RATE_LIMITED', 429],
]);
export const ACCOUNT_DELETION_CODES: ReadonlyMap<string, number> = new Map([
  ['INVALID_PASSWORD', 400],
]);
