import type { PgBoss } from 'pg-boss' with { 'resolution-mode': 'import' };
import {
  JobQueuePort,
  JobName,
  JobDataMap,
  SendJobOptions,
} from './job-queue.port';

export class PgBossJobQueue implements JobQueuePort {
  constructor(private readonly boss: PgBoss) {}

  async send<T extends JobName>(
    name: T,
    data: JobDataMap[T],
    options?: SendJobOptions,
  ): Promise<string | null> {
    const sendOptions: Parameters<PgBoss['send']>[2] = {
      singletonKey: options?.singletonKey,
      startAfter: options?.startAfter,
    };

    if (options?.tx) {
      const tx = options.tx;
      sendOptions.db = {
        executeSql: async (text: string, values: unknown[]) => {
          const result = await tx.$queryRawUnsafe<unknown[]>(text, ...values);
          return { rows: result };
        },
      };
    }

    const id = await this.boss.send(name, data as object, sendOptions);
    return id ?? null;
  }
}
