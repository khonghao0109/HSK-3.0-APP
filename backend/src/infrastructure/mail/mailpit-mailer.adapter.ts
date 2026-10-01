import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MailDeliveryError,
  MailerPort,
  SendMailOptions,
  SendMailResult,
  validateAndNormalizeMailInput,
} from './mailer.port';

@Injectable()
export class MailpitMailerAdapter implements MailerPort {
  private readonly from: string;
  private readonly sendUrl: string;
  private readonly requestTimeoutMs: number;

  constructor(config: ConfigService, requestTimeoutMs = 8_000) {
    this.from = config.getOrThrow<string>('MAIL_FROM');
    const mailpitUrl = config.getOrThrow<string>('MAIL_MAILPIT_URL');
    this.sendUrl = new URL('/api/v1/send', mailpitUrl).toString();
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async send(message: SendMailOptions): Promise<SendMailResult> {
    const { from, to } = validateAndNormalizeMailInput(this.from, message);

    const payload: {
      From: { Email: string };
      To: Array<{ Email: string }>;
      Subject: string;
      Text: string;
      HTML?: string;
    } = {
      From: { Email: from },
      To: [{ Email: to }],
      Subject: message.subject,
      Text: message.text,
      ...(message.html ? { HTML: message.html } : {}),
    };

    try {
      const response = await fetch(this.sendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });

      if (response.ok) {
        const data = (await response.json()) as { ID?: string };
        if (!data?.ID) {
          throw new MailDeliveryError('Failed to deliver email via Mailpit.', {
            retryable: false,
            cause: new Error('Mailpit response missing ID field'),
          });
        }
        return { providerMessageId: data.ID };
      }

      const retryable = response.status >= 500;
      throw new MailDeliveryError('Failed to deliver email via Mailpit.', {
        retryable,
        cause: new Error(`Mailpit returned HTTP status ${response.status}`),
      });
    } catch (error: unknown) {
      if (error instanceof MailDeliveryError) {
        throw error;
      }
      throw new MailDeliveryError('Failed to deliver email via Mailpit.', {
        retryable: true,
        cause: error,
      });
    }
  }
}
