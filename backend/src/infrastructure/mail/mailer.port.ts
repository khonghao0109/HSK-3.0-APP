export const MAILER_PORT = Symbol('MAILER_PORT');

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendMailResult {
  providerMessageId: string;
}

export interface MailerPort {
  send(message: SendMailOptions): Promise<SendMailResult>;
}

export class MailDeliveryError extends Error {
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(
    message: string,
    options: { retryable: boolean; cause?: unknown },
  ) {
    super(message);
    this.name = 'MailDeliveryError';
    this.retryable = options.retryable;
    this.cause = options.cause;
  }
}

const EMAIL_PATTERN = /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/;

export function validateAndNormalizeMailInput(
  from: string,
  message: SendMailOptions,
): { from: string; to: string } {
  if (from.includes('\r') || from.includes('\n')) {
    throw new MailDeliveryError('Invalid sender email address.', {
      retryable: false,
    });
  }

  if (message.subject.includes('\r') || message.subject.includes('\n')) {
    throw new MailDeliveryError('Invalid email subject.', {
      retryable: false,
    });
  }

  const normalizedTo = message.to.trim().toLowerCase();

  if (
    normalizedTo.includes('\r') ||
    normalizedTo.includes('\n') ||
    !EMAIL_PATTERN.test(normalizedTo)
  ) {
    throw new MailDeliveryError('Invalid recipient email address.', {
      retryable: false,
    });
  }

  if (!EMAIL_PATTERN.test(from.trim())) {
    throw new MailDeliveryError('Invalid sender email address.', {
      retryable: false,
    });
  }

  return {
    from: from.trim(),
    to: normalizedTo,
  };
}
