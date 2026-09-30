import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { ConfigService } from '@nestjs/config';
import { MailDeliveryError } from './mailer.port';
import { classifySesError, SesMailerAdapter } from './ses-mailer.adapter';

describe('SesMailerAdapter', () => {
  let mockClient: { send: jest.Mock };
  let config: ConfigService;
  let adapter: SesMailerAdapter;

  beforeEach(() => {
    mockClient = {
      send: jest.fn(),
    };
    class MockConfig extends ConfigService {
      override getOrThrow<T = string>(key: string): T {
        if (key === 'MAIL_FROM') return 'noreply@example.com' as T;
        if (key === 'MAIL_SES_REGION') return 'ap-southeast-1' as T;
        throw new Error(`Unknown config key: ${key}`);
      }
    }
    config = new MockConfig();
    adapter = new SesMailerAdapter(config, mockClient, 2000);
  });

  describe('successful send', () => {
    it('constructs correct SendEmailCommand and returns providerMessageId', async () => {
      mockClient.send.mockResolvedValueOnce({
        MessageId: 'ses-msg-12345',
      });

      const result = await adapter.send({
        to: '  Learner@Example.Com  ',
        subject: 'Verify your account',
        text: 'Your code is 654321',
        html: '<p>Your code is 654321</p>',
      });

      expect(result).toEqual({ providerMessageId: 'ses-msg-12345' });
      expect(mockClient.send).toHaveBeenCalledTimes(1);

      const command = mockClient.send.mock.calls[0]?.[0] as SendEmailCommand;
      expect(command).toBeInstanceOf(SendEmailCommand);
      expect(command.input).toEqual({
        FromEmailAddress: 'noreply@example.com',
        Destination: {
          ToAddresses: ['learner@example.com'],
        },
        Content: {
          Simple: {
            Subject: {
              Data: 'Verify your account',
              Charset: 'UTF-8',
            },
            Body: {
              Text: {
                Data: 'Your code is 654321',
                Charset: 'UTF-8',
              },
              Html: {
                Data: '<p>Your code is 654321</p>',
                Charset: 'UTF-8',
              },
            },
          },
        },
      });
    });

    it('omits Html when not provided in message', async () => {
      mockClient.send.mockResolvedValueOnce({
        MessageId: 'ses-msg-text-only',
      });

      await adapter.send({
        to: 'user@example.com',
        subject: 'Plain Subject',
        text: 'Plain text',
      });

      const command = mockClient.send.mock.calls[0]?.[0] as SendEmailCommand;
      expect(command.input.Content?.Simple?.Body?.Html).toBeUndefined();
      expect(command.input.Content?.Simple?.Body?.Text?.Data).toBe(
        'Plain text',
      );
    });
  });

  describe('error classification (P4 & P6)', () => {
    it.each([
      ['MessageRejected'],
      ['MailFromDomainNotVerifiedException'],
      ['AccountSuspendedException'],
      ['SendingPausedException'],
      ['BadRequestException'],
    ])(
      'classifies %s as non-retryable (retryable: false)',
      async (errorName) => {
        const sesError = new Error('Permanent failure');
        sesError.name = errorName;
        mockClient.send.mockRejectedValueOnce(sesError);

        let thrown: unknown;
        try {
          await adapter.send({
            to: 'learner@example.com',
            subject: 'Test',
            text: 'Body',
          });
        } catch (err) {
          thrown = err;
        }

        expect(thrown).toBeInstanceOf(MailDeliveryError);
        const error = thrown as MailDeliveryError;
        expect(error.retryable).toBe(false);
        expect(error.message).toBe('Failed to deliver email via SES.');
        expect(error.message).not.toContain('learner@example.com');
      },
    );

    it.each([['TooManyRequestsException'], ['LimitExceededException']])(
      'classifies %s as retryable (retryable: true)',
      async (errorName) => {
        const throttleError = new Error('Rate limit exceeded');
        throttleError.name = errorName;
        mockClient.send.mockRejectedValueOnce(throttleError);

        try {
          await adapter.send({
            to: 'learner@example.com',
            subject: 'Test',
            text: 'Body',
          });
          fail('should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(MailDeliveryError);
          const error = err as MailDeliveryError;
          expect(error.retryable).toBe(true);
        }
      },
    );

    it('classifies HTTP 5xx as retryable', async () => {
      const serverError = Object.assign(new Error('Internal Server Error'), {
        $metadata: { httpStatusCode: 503 },
      });
      mockClient.send.mockRejectedValueOnce(serverError);

      try {
        await adapter.send({
          to: 'learner@example.com',
          subject: 'Test',
          text: 'Body',
        });
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(MailDeliveryError);
        const error = err as MailDeliveryError;
        expect(error.retryable).toBe(true);
      }
    });

    it('classifies timeout as retryable', async () => {
      const timeoutError = new Error('Connection timed out');
      timeoutError.name = 'TimeoutError';
      mockClient.send.mockRejectedValueOnce(timeoutError);

      try {
        await adapter.send({
          to: 'learner@example.com',
          subject: 'Test',
          text: 'Body',
        });
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(MailDeliveryError);
        const error = err as MailDeliveryError;
        expect(error.retryable).toBe(true);
      }
    });

    it('classifies network error code ECONNRESET as retryable', async () => {
      const netError = Object.assign(new Error('Socket closed'), {
        code: 'ECONNRESET',
      });
      mockClient.send.mockRejectedValueOnce(netError);

      try {
        await adapter.send({
          to: 'learner@example.com',
          subject: 'Test',
          text: 'Body',
        });
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(MailDeliveryError);
        const error = err as MailDeliveryError;
        expect(error.retryable).toBe(true);
      }
    });
  });

  describe('header injection and PII protection (P6)', () => {
    it('throws on CRLF in subject and DOES NOT call client', async () => {
      await expect(
        adapter.send({
          to: 'valid@example.com',
          subject: 'Subject\r\nBcc: evil@attacker.com',
          text: 'Body',
        }),
      ).rejects.toThrow(MailDeliveryError);

      expect(mockClient.send).not.toHaveBeenCalled();
    });

    it('throws on CRLF in from and DOES NOT call client', async () => {
      class BadFromConfig extends ConfigService {
        override getOrThrow<T = string>(key: string): T {
          if (key === 'MAIL_FROM')
            return 'noreply@example.com\r\nBcc: evil@attacker.com' as T;
          if (key === 'MAIL_SES_REGION') return 'ap-southeast-1' as T;
          throw new Error(`Unknown config key: ${key}`);
        }
      }
      const badAdapter = new SesMailerAdapter(new BadFromConfig(), mockClient);

      await expect(
        badAdapter.send({
          to: 'valid@example.com',
          subject: 'Valid Subject',
          text: 'Body',
        }),
      ).rejects.toThrow(MailDeliveryError);

      expect(mockClient.send).not.toHaveBeenCalled();
    });

    it('ensures error.message never contains recipient address', async () => {
      const sensitiveRecipient = 'sensitive.student.address@school.edu.vn';
      mockClient.send.mockRejectedValueOnce(
        new Error('SES connection failure'),
      );

      try {
        await adapter.send({
          to: sensitiveRecipient,
          subject: 'Confidential Info',
          text: 'Your confidential token is 123456',
        });
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(MailDeliveryError);
        const error = err as MailDeliveryError;
        expect(error.message).not.toContain(sensitiveRecipient);
        expect(error.message).not.toContain('Confidential Info');
        expect(error.message).not.toContain('123456');
      }
    });
  });

  describe('classifySesError direct unit tests', () => {
    it('returns false for null or non-object', () => {
      expect(classifySesError(null)).toBe(false);
      expect(classifySesError('string')).toBe(false);
      expect(classifySesError(123)).toBe(false);
    });
  });
});
