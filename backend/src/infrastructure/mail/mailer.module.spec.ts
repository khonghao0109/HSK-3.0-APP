import { ConfigService } from '@nestjs/config';

import { InMemoryMailerAdapter } from './in-memory-mailer.adapter';
import { MailpitMailerAdapter } from './mailpit-mailer.adapter';
import { SesMailerAdapter } from './ses-mailer.adapter';
import { createMailerAdapter } from './mailer.module';

describe('createMailerAdapter', () => {
  const memory = new InMemoryMailerAdapter();

  class MockConfig extends ConfigService {
    constructor(private readonly values: Record<string, string>) {
      super();
    }
    override getOrThrow<T = string>(key: string): T {
      if (key in this.values) return this.values[key] as T;
      throw new Error(`Missing config: ${key}`);
    }
    override get<T = string>(key: string): T | undefined {
      return this.values[key] as T | undefined;
    }
  }

  const mockConfig = (values: Record<string, string>): ConfigService =>
    new MockConfig(values);

  it('creates SesMailerAdapter when MAIL_PROVIDER is ses', () => {
    const config = mockConfig({
      MAIL_PROVIDER: 'ses',
      MAIL_FROM: 'noreply@example.com',
      MAIL_SES_REGION: 'ap-southeast-1',
    });
    const adapter = createMailerAdapter(memory, config);
    expect(adapter).toBeInstanceOf(SesMailerAdapter);
  });

  it('creates MailpitMailerAdapter when MAIL_PROVIDER is mailpit', () => {
    const config = mockConfig({
      MAIL_PROVIDER: 'mailpit',
      MAIL_FROM: 'noreply@example.com',
      MAIL_MAILPIT_URL: 'http://127.0.0.1:8025',
    });
    const adapter = createMailerAdapter(memory, config);
    expect(adapter).toBeInstanceOf(MailpitMailerAdapter);
  });

  it('returns InMemoryMailerAdapter when MAIL_PROVIDER is memory', () => {
    const config = mockConfig({
      MAIL_PROVIDER: 'memory',
    });
    const adapter = createMailerAdapter(memory, config);
    expect(adapter).toBe(memory);
  });

  it('throws when MAIL_PROVIDER is unsupported', () => {
    const config = mockConfig({
      MAIL_PROVIDER: 'unknown',
    });
    expect(() => createMailerAdapter(memory, config)).toThrow(
      'Unsupported mail provider.',
    );
  });
});
