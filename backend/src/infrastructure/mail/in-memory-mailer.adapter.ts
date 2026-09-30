import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  MailerPort,
  SendMailOptions,
  SendMailResult,
  validateAndNormalizeMailInput,
} from './mailer.port';

export interface InMemorySentMail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  providerMessageId: string;
  sentAt: Date;
}

@Injectable()
export class InMemoryMailerAdapter implements MailerPort {
  private readonly from: string;
  readonly sentMessages: InMemorySentMail[] = [];

  constructor(config?: ConfigService) {
    this.from = config?.get<string>('MAIL_FROM') ?? 'noreply@example.com';
  }

  send(message: SendMailOptions): Promise<SendMailResult> {
    const { from, to } = validateAndNormalizeMailInput(this.from, message);
    const providerMessageId = `mem-${randomUUID()}`;

    this.sentMessages.push({
      from,
      to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      providerMessageId,
      sentAt: new Date(),
    });

    return Promise.resolve({ providerMessageId });
  }

  clear(): void {
    this.sentMessages.length = 0;
  }
}
