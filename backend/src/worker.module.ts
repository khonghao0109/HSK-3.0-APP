import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import mediaConfig from './config/media.config';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { JobsModule } from './infrastructure/jobs/jobs.module';
import { MailerModule } from './infrastructure/mail/mailer.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { PurgeExpiredSessionsJob } from './modules/auth/jobs/purge-expired-sessions.job';
import { SendEmailVerificationJob } from './modules/auth/jobs/send-email-verification.job';
import { SendPasswordResetJob } from './modules/auth/jobs/send-password-reset.job';
import { AnonymizeAccountJob } from './modules/user/jobs/anonymize-account.job';
import { SendAccountDeletionScheduledJob } from './modules/user/jobs/send-account-deletion-scheduled.job';
import { DataExportJob } from './modules/user/jobs/data-export.job';
import { PurgeExpiredExportsJob } from './modules/user/jobs/purge-expired-exports.job';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, mediaConfig],
      validationSchema: envValidationSchema,
    }),
    PrismaModule,
    JobsModule.register({ isWorker: true }),
    MailerModule,
    StorageModule,
  ],
  providers: [
    PurgeExpiredSessionsJob,
    SendEmailVerificationJob,
    SendPasswordResetJob,
    AnonymizeAccountJob,
    SendAccountDeletionScheduledJob,
    DataExportJob,
    PurgeExpiredExportsJob,
  ],
})
export class WorkerModule {}
