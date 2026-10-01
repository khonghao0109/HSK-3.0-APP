import { ConfigService } from '@nestjs/config';
import { InMemoryMailerAdapter } from './in-memory-mailer.adapter';

describe('InMemoryMailerAdapter', () => {
  let adapter: InMemoryMailerAdapter;

  beforeEach(() => {
    class MockConfig extends ConfigService {
      override get<T = string>(key: string): T | undefined {
        if (key === 'MAIL_FROM') return 'noreply@hsk.local' as T;
        return undefined;
      }
    }
    adapter = new InMemoryMailerAdapter(new MockConfig());
  });

  it('records sent emails in sentMessages and returns unique providerMessageId', async () => {
    const res1 = await adapter.send({
      to: 'Learner@example.com',
      subject: 'Welcome',
      text: 'Hello world',
    });

    expect(res1.providerMessageId).toMatch(/^mem-/);
    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0]?.to).toBe('learner@example.com');
    expect(adapter.sentMessages[0]?.from).toBe('noreply@hsk.local');
    expect(adapter.sentMessages[0]?.subject).toBe('Welcome');
    expect(adapter.sentMessages[0]?.text).toBe('Hello world');

    const res2 = await adapter.send({
      to: 'admin@example.com',
      subject: 'Alert',
      text: 'Disk space warning',
      html: '<p>Disk space warning</p>',
    });

    expect(res2.providerMessageId).toMatch(/^mem-/);
    expect(res2.providerMessageId).not.toBe(res1.providerMessageId);
    expect(adapter.sentMessages).toHaveLength(2);
    expect(adapter.sentMessages[1]?.html).toBe('<p>Disk space warning</p>');
  });

  it('clears sentMessages on clear()', async () => {
    await adapter.send({
      to: 'learner@example.com',
      subject: 'Test',
      text: 'Text',
    });
    expect(adapter.sentMessages).toHaveLength(1);
    adapter.clear();
    expect(adapter.sentMessages).toHaveLength(0);
  });
});
