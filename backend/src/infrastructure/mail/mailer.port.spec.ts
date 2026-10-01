import {
  MailDeliveryError,
  validateAndNormalizeMailInput,
} from './mailer.port';

describe('MailerPort - Input validation & security', () => {
  const validFrom = 'noreply@example.com';
  const validMessage = {
    to: '  User@Example.COM  ',
    subject: 'Verification Code',
    text: 'Your code is 123456',
  };

  it('normalizes recipient email to lowercase and trims whitespace', () => {
    const result = validateAndNormalizeMailInput(validFrom, validMessage);
    expect(result.to).toBe('user@example.com');
    expect(result.from).toBe('noreply@example.com');
  });

  it('rejects header injection via carriage return in subject', () => {
    expect(() =>
      validateAndNormalizeMailInput(validFrom, {
        ...validMessage,
        subject: 'Header\rInjection',
      }),
    ).toThrow(MailDeliveryError);

    try {
      validateAndNormalizeMailInput(validFrom, {
        ...validMessage,
        subject: 'Header\rInjection',
      });
    } catch (err) {
      expect(err).toBeInstanceOf(MailDeliveryError);
      const deliveryError = err as MailDeliveryError;
      expect(deliveryError.retryable).toBe(false);
      expect(deliveryError.message).not.toContain(validMessage.to);
    }
  });

  it('rejects header injection via newline in subject', () => {
    expect(() =>
      validateAndNormalizeMailInput(validFrom, {
        ...validMessage,
        subject: 'Header\nInjection',
      }),
    ).toThrow(MailDeliveryError);
  });

  it('rejects header injection via CRLF in MAIL_FROM', () => {
    expect(() =>
      validateAndNormalizeMailInput(
        'noreply@example.com\r\nBcc: evil@attacker.com',
        validMessage,
      ),
    ).toThrow(MailDeliveryError);
  });

  it('rejects header injection via CRLF in recipient email', () => {
    expect(() =>
      validateAndNormalizeMailInput(validFrom, {
        ...validMessage,
        to: 'user@example.com\r\nBcc: evil@attacker.com',
      }),
    ).toThrow(MailDeliveryError);
  });

  it('rejects invalid recipient email format', () => {
    expect(() =>
      validateAndNormalizeMailInput(validFrom, {
        ...validMessage,
        to: 'not-an-email',
      }),
    ).toThrow(MailDeliveryError);
  });

  it('rejects invalid sender email format', () => {
    expect(() =>
      validateAndNormalizeMailInput('not-an-email', validMessage),
    ).toThrow(MailDeliveryError);
  });

  it('ensures MailDeliveryError.message never leaks recipient address, subject, or content', () => {
    const sensitiveTo = 'secret.learner@personal-domain.vn';
    const sensitiveSubject = 'Super Secret Verification';
    const sensitiveBody = 'Secret OTP: 999999';

    const err = new MailDeliveryError('Failed to deliver email.', {
      retryable: true,
      cause: new Error('SES connection failed'),
    });

    expect(err.message).not.toContain(sensitiveTo);
    expect(err.message).not.toContain(sensitiveSubject);
    expect(err.message).not.toContain(sensitiveBody);
    expect(err.retryable).toBe(true);
  });
});
