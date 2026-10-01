import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { InMemoryMailerAdapter } from './in-memory-mailer.adapter';
import { MailpitMailerAdapter } from './mailpit-mailer.adapter';
import { MAILER_PORT, type MailerPort } from './mailer.port';
import { SesMailerAdapter } from './ses-mailer.adapter';

@Module({
  providers: [
    InMemoryMailerAdapter,
    {
      provide: MAILER_PORT,
      useFactory: (memory: InMemoryMailerAdapter, config: ConfigService) =>
        createMailerAdapter(memory, config),
      inject: [InMemoryMailerAdapter, ConfigService],
    },
  ],
  exports: [MAILER_PORT, InMemoryMailerAdapter],
})
export class MailerModule {}

/**
 * Selects the adapter named by MAIL_PROVIDER.
 * Runtime security validation enforces environment restrictions before bootstrap.
 */
export function createMailerAdapter(
  memory: InMemoryMailerAdapter,
  config: ConfigService,
): MailerPort {
  const provider = config.getOrThrow<string>('MAIL_PROVIDER');
  if (provider === 'ses') return new SesMailerAdapter(config);
  if (provider === 'mailpit') return new MailpitMailerAdapter(config);
  if (provider === 'memory') return memory;
  throw new Error('Unsupported mail provider.');
}
