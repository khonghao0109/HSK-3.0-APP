import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MailDeliveryError,
  MailerPort,
  SendMailOptions,
  SendMailResult,
  validateAndNormalizeMailInput,
} from './mailer.port';

export const SES_CLIENT_OVERRIDE = Symbol('SES_CLIENT_OVERRIDE');

const NON_RETRYABLE_SES_ERRORS = new Set([
  'MessageRejected',
  'MailFromDomainNotVerifiedException',
  'AccountSuspendedException',
  'SendingPausedException',
  'BadRequestException',
]);

const RETRYABLE_SES_ERRORS = new Set([
  'TooManyRequestsException',
  'LimitExceededException',
]);

export function classifySesError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const name =
    'name' in error && typeof error.name === 'string' ? error.name : '';

  if (RETRYABLE_SES_ERRORS.has(name)) {
    return true;
  }
  if (NON_RETRYABLE_SES_ERRORS.has(name)) {
    return false;
  }

  if (name === 'TimeoutError' || name === 'AbortError') {
    return true;
  }

  const code =
    'code' in error && typeof error.code === 'string' ? error.code : '';
  if (
    code === 'ECONNRESET' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT'
  ) {
    return true;
  }

  const statusCode =
    '$metadata' in error &&
    typeof error.$metadata === 'object' &&
    error.$metadata !== null &&
    'httpStatusCode' in error.$metadata &&
    typeof error.$metadata.httpStatusCode === 'number'
      ? error.$metadata.httpStatusCode
      : undefined;

  if (statusCode !== undefined) {
    if (statusCode >= 500) return true;
    if (statusCode === 429) return true;
    if (statusCode >= 400) return false;
  }

  return false;
}

class MailOperationDeadline {
  private readonly controller = new AbortController();
  private readonly timeout: NodeJS.Timeout;
  private readonly expiration: Promise<never>;
  expired = false;

  constructor(timeoutMs: number) {
    let rejectExpiration: (error: Error) => void = () => undefined;
    this.expiration = new Promise((_, reject) => {
      rejectExpiration = reject;
    });
    this.timeout = setTimeout(() => {
      this.expired = true;
      this.controller.abort();
      const timeoutError = new Error('SES mail operation timed out');
      timeoutError.name = 'TimeoutError';
      rejectExpiration(timeoutError);
    }, timeoutMs);
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  race<T>(operation: Promise<T>): Promise<T> {
    return Promise.race([operation, this.expiration]).then(
      (value) => {
        if (this.expired) {
          const err = new Error('SES mail operation timed out');
          err.name = 'TimeoutError';
          throw err;
        }
        return value;
      },
      (error: unknown) => {
        if (this.expired) {
          const err = new Error('SES mail operation timed out');
          err.name = 'TimeoutError';
          throw err;
        }
        throw error;
      },
    );
  }

  dispose(): void {
    clearTimeout(this.timeout);
  }
}

export type SesClientLike = {
  send: (
    command: SendEmailCommand,
    options?: { abortSignal?: AbortSignal },
  ) => Promise<{ MessageId?: string }>;
};

@Injectable()
export class SesMailerAdapter implements MailerPort {
  private readonly from: string;
  private readonly region: string;
  private readonly client: SESv2Client | SesClientLike;
  private readonly requestTimeoutMs: number;

  constructor(
    config: ConfigService,
    @Optional()
    @Inject(SES_CLIENT_OVERRIDE)
    clientOverride?: SESv2Client | SesClientLike,
    requestTimeoutMs = 8_000,
  ) {
    this.from = config.getOrThrow<string>('MAIL_FROM');
    this.region = config.getOrThrow<string>('MAIL_SES_REGION');
    this.client =
      clientOverride ??
      new SESv2Client({
        region: this.region,
        maxAttempts: 2,
      });
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async send(message: SendMailOptions): Promise<SendMailResult> {
    const { from, to } = validateAndNormalizeMailInput(this.from, message);
    const deadline = new MailOperationDeadline(this.requestTimeoutMs);

    try {
      const command = new SendEmailCommand({
        FromEmailAddress: from,
        Destination: {
          ToAddresses: [to],
        },
        Content: {
          Simple: {
            Subject: {
              Data: message.subject,
              Charset: 'UTF-8',
            },
            Body: {
              Text: {
                Data: message.text,
                Charset: 'UTF-8',
              },
              ...(message.html
                ? {
                    Html: {
                      Data: message.html,
                      Charset: 'UTF-8',
                    },
                  }
                : {}),
            },
          },
        },
      });

      const response = await deadline.race(
        this.client.send(command, { abortSignal: deadline.signal }),
      );

      return {
        providerMessageId: response.MessageId ?? '',
      };
    } catch (error: unknown) {
      const retryable = classifySesError(error);
      throw new MailDeliveryError('Failed to deliver email via SES.', {
        retryable,
        cause: error,
      });
    } finally {
      deadline.dispose();
    }
  }
}
