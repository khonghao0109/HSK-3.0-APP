import { Injectable, Inject, OnApplicationShutdown } from '@nestjs/common';
import { PG_BOSS_INSTANCE } from './job-queue.port';
import type { PgBoss } from 'pg-boss' with { 'resolution-mode': 'import' };

@Injectable()
export class PgBossLifecycle implements OnApplicationShutdown {
  constructor(@Inject(PG_BOSS_INSTANCE) private readonly boss: PgBoss | null) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.boss) {
      await this.boss.stop({ graceful: true, timeout: 30000 });
    }
  }
}
