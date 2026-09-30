import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { JobsModule } from './infrastructure/jobs/jobs.module';
import { MailerModule } from './infrastructure/mail/mailer.module';
import { PurgeExpiredSessionsJob } from './modules/auth/jobs/purge-expired-sessions.job';
import { SendEmailVerificationJob } from './modules/auth/jobs/send-email-verification.job';
import { SendPasswordResetJob } from './modules/auth/jobs/send-password-reset.job';
import { AnonymizeAccountJob } from './modules/user/jobs/anonymize-account.job';
import { SendAccountDeletionScheduledJob } from './modules/user/jobs/send-account-deletion-scheduled.job';

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
  providers: [
    PurgeExpiredSessionsJob,
    SendEmailVerificationJob,
    SendPasswordResetJob,
    AnonymizeAccountJob,
    SendAccountDeletionScheduledJob,
  ],
})
export class WorkerModule {}
