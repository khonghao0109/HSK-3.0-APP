import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import { withUtcSessionTimeZone } from './utc-session-database-url';

export const PRISMA_CLIENT_OPTIONS = Symbol('PRISMA_CLIENT_OPTIONS');

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    @Optional()
    @Inject(PRISMA_CLIENT_OPTIONS)
    options?: Prisma.PrismaClientOptions,
  ) {
    super(withUtcSessionDatasource(options));
  }

  async onModuleInit() {
    await this.$connect();
  }

  // Nest runs this on app.close() and, with enableShutdownHooks() in main.ts,
  // on SIGTERM/SIGINT; it releases the pooled PostgreSQL connections instead of
  // leaving them for the process to drop.
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

function withUtcSessionDatasource(
  options: Prisma.PrismaClientOptions = {},
): Prisma.PrismaClientOptions {
  const databaseUrl = options.datasources?.db?.url ?? process.env.DATABASE_URL;
  if (!databaseUrl) return options;
  return {
    ...options,
    datasources: {
      ...options.datasources,
      db: {
        ...options.datasources?.db,
        url: withUtcSessionTimeZone(databaseUrl),
      },
    },
  };
}
