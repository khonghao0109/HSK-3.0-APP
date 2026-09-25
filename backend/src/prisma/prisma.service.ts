import {
  INestApplication,
  Inject,
  Injectable,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import { withUtcSessionTimeZone } from './utc-session-database-url';

export const PRISMA_CLIENT_OPTIONS = Symbol('PRISMA_CLIENT_OPTIONS');

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
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

  enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', () => {
      void app.close();
    });
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
