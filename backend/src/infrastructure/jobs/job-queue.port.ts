import { Prisma } from '@prisma/client';

export const JOB_NAMES = {
  PURGE_EXPIRED_SESSIONS: 'session.purge-expired',
  SEND_EMAIL_VERIFICATION: 'mail.email-verification',
  SEND_PASSWORD_RESET: 'mail.password-reset',
  ANONYMIZE_ACCOUNT: 'privacy.anonymize-account',
  SEND_ACCOUNT_DELETION_SCHEDULED: 'mail.account-deletion-scheduled',
} as const;

export interface JobDataMap {
  [JOB_NAMES.PURGE_EXPIRED_SESSIONS]: Record<string, never> | null;
  [JOB_NAMES.SEND_EMAIL_VERIFICATION]: { userId: number };
  [JOB_NAMES.SEND_PASSWORD_RESET]: { userId: number };
  [JOB_NAMES.ANONYMIZE_ACCOUNT]: { requestId: number };
  [JOB_NAMES.SEND_ACCOUNT_DELETION_SCHEDULED]: { requestId: number };
}

export type JobName = keyof JobDataMap;

export interface SendJobOptions {
  singletonKey?: string;
  startAfter?: number | string | Date;
  tx?: Prisma.TransactionClient;
}

export const JobQueuePort = Symbol('JobQueuePort');
export const PG_BOSS_INSTANCE = Symbol('PG_BOSS_INSTANCE');

export interface JobQueuePort {
  send<T extends JobName>(
    name: T,
    data: JobDataMap[T],
    options?: SendJobOptions,
  ): Promise<string | null>;
}
