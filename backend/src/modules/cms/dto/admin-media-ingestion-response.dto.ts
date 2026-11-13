import { AdminDataSourceDto } from './admin-exercise-response.dto';

/** TL-47: one ingestion that needs reconciliation; storage internals stay server-side. */
export class AdminMediaIngestionDto {
  id!: number;
  status!: 'cleanup_required' | 'processing';
  failureCode!: string | null;
  /** Sanitized original filename. */
  filename!: string | null;
  size!: number;
  dataSource!: AdminDataSourceDto;
  startedAt!: Date;
  processingStartedAt!: Date | null;
  cleanupRequiredAt!: Date | null;
  cleanupAttempts!: number;
  cleanupLastAttemptAt!: Date | null;
  /** True only for `cleanup_required` rows written by the current storage provider. */
  cleanupAvailable!: boolean;
}
