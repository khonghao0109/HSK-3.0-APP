import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { JobsModule } from './infrastructure/jobs/jobs.module';
import { MailerModule } from './infrastructure/mail/mailer.module';
import { PurgeExpiredSessionsJob } from './modules/auth/jobs/purge-expired-sessions.job';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig],
      validationSchema: envValidationSchema,
    }),
    PrismaModule,
    JobsModule.register({ isWorker: true }),
    MailerModule,
  ],
  providers: [PurgeExpiredSessionsJob],
})
export class WorkerModule {}
