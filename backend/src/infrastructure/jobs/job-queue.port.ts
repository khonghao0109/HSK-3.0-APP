import { Prisma } from '@prisma/client';

export const JOB_NAMES = {
  PURGE_EXPIRED_SESSIONS: 'session.purge-expired',
} as const;

export interface JobDataMap {
  [JOB_NAMES.PURGE_EXPIRED_SESSIONS]: Record<string, never> | null;
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
