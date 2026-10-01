import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';
import { PG_BOSS_INSTANCE } from './infrastructure/jobs/jobs.module';
import type { PgBoss } from 'pg-boss' with { 'resolution-mode': 'import' };

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const logger = new Logger('Worker');

  logger.log('Worker process started');

  let isStopping = false;
  const shutdown = async () => {
    if (isStopping) {
      logger.warn('Already stopping, ignoring signal');
      return;
    }
    isStopping = true;

    logger.log('Stopping worker gracefully...');
    try {
      const boss = app.get<PgBoss | null>(PG_BOSS_INSTANCE);
      if (boss) {
        await boss.stop({ graceful: true, timeout: 30000 });
      }
      await app.close();
      logger.log('Worker stopped');
      process.exit(0);
    } catch (err) {
      logger.error('Error during worker shutdown', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => {
    void shutdown();
  });
  process.on('SIGINT', () => {
    void shutdown();
  });
}

bootstrap().catch((err: unknown) => {
  console.error('Worker failed to start', err);
  process.exit(1);
});
