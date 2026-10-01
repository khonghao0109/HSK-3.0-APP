import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { MailDeliveryError } from './mailer.port';
import { MailpitMailerAdapter } from './mailpit-mailer.adapter';

/**
 * Mailpit API specification reference:
 * - Docs: https://mailpit.axllent.org/docs/api-v1/
 * - Swagger schema: https://raw.githubusercontent.com/axllent/mailpit/master/server/ui/api/v1/swagger.json
 * - Endpoint: POST /api/v1/send
 * - Response schema: { "ID": string } (200 OK)
 */

describe('MailpitMailerAdapter', () => {
  let server: http.Server;
  let serverUrl: string;
  let receivedRequests: Array<{
    method: string;
    url: string;
    headers: http.IncomingHttpHeaders;
    body: Record<string, unknown>;
  }>;
  let responseHandler: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) => void;

  beforeAll((done) => {
    receivedRequests = [];
    server = http.createServer((req, res) => {
      let bodyData = '';
      req.on('data', (chunk) => {
        bodyData += chunk;
      });
      req.on('end', () => {
        let parsedBody: Record<string, unknown> = {};
        if (bodyData) {
          try {
            parsedBody = JSON.parse(bodyData) as Record<string, unknown>;
          } catch {
            parsedBody = { raw: bodyData };
          }
        }
        receivedRequests.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body: parsedBody,
        });

        if (responseHandler) {
          responseHandler(req, res);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ID: 'default-stub-id' }));
        }
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      serverUrl = `http://127.0.0.1:${address.port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    receivedRequests = [];
  });

  function createAdapter(
    from = 'noreply@example.com',
    timeoutMs = 2000,
  ): MailpitMailerAdapter {
    class MockConfig extends ConfigService {
      override getOrThrow<T = string>(key: string): T {
        if (key === 'MAIL_FROM') return from as T;
        if (key === 'MAIL_MAILPIT_URL') return serverUrl as T;
        throw new Error(`Unknown config key: ${key}`);
      }
    }
    return new MailpitMailerAdapter(new MockConfig(), timeoutMs);
  }

  describe('successful send (P5)', () => {
    it('sends correct JSON schema to /api/v1/send and extracts ID as providerMessageId', async () => {
      responseHandler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ID: 'mailpit-msg-abc123xyz' }));
      };

      const adapter = createAdapter();
      const result = await adapter.send({
        to: '  Learner@Example.Com  ',
        subject: 'Reset Password',
        text: 'Your password reset link is here',
        html: '<p>Your password reset link is here</p>',
      });

      expect(result).toEqual({ providerMessageId: 'mailpit-msg-abc123xyz' });
      expect(receivedRequests).toHaveLength(1);

      const sentReq = receivedRequests[0];
      expect(sentReq?.method).toBe('POST');
      expect(sentReq?.url).toBe('/api/v1/send');
      expect(sentReq?.headers['content-type']).toBe('application/json');

      expect(sentReq?.body).toEqual({
        From: { Email: 'noreply@example.com' },
        To: [{ Email: 'learner@example.com' }],
        Subject: 'Reset Password',
        Text: 'Your password reset link is here',
        HTML: '<p>Your password reset link is here</p>',
      });
    });

    it('omits HTML field when html is not provided', async () => {
      responseHandler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ID: 'mailpit-plain-id' }));
      };

      const adapter = createAdapter();
      await adapter.send({
        to: 'user@example.com',
        subject: 'Plain Text Only',
        text: 'Hello plain text',
      });

      expect(receivedRequests[0]?.body).not.toHaveProperty('HTML');
      expect(receivedRequests[0]?.body).toEqual({
        From: { Email: 'noreply@example.com' },
        To: [{ Email: 'user@example.com' }],
        Subject: 'Plain Text Only',
        Text: 'Hello plain text',
      });
    });
  });

  describe('error classification (P5)', () => {
    it('classifies 5xx errors as retryable', async () => {
      responseHandler = (_req, res) => {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Service Unavailable' }));
      };

      const adapter = createAdapter();
      try {
        await adapter.send({
          to: 'learner@example.com',
          subject: 'Test',
          text: 'Text',
        });
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(MailDeliveryError);
        const error = err as MailDeliveryError;
        expect(error.retryable).toBe(true);
        expect(error.message).toBe('Failed to deliver email via Mailpit.');
        expect(error.message).not.toContain('learner@example.com');
      }
    });

    it('classifies 4xx errors as non-retryable', async () => {
      responseHandler = (_req, res) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad Request' }));
      };

      const adapter = createAdapter();
      try {
        await adapter.send({
          to: 'learner@example.com',
          subject: 'Test',
          text: 'Text',
        });
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(MailDeliveryError);
        const error = err as MailDeliveryError;
        expect(error.retryable).toBe(false);
      }
    });

    it('classifies timeouts as retryable', async () => {
      responseHandler = () => {
        // Intentionally do not respond, causing timeout
      };

      const shortTimeoutAdapter = createAdapter('noreply@example.com', 100);
      try {
        await shortTimeoutAdapter.send({
          to: 'learner@example.com',
          subject: 'Test',
          text: 'Text',
        });
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(MailDeliveryError);
        const error = err as MailDeliveryError;
        expect(error.retryable).toBe(true);
        expect(error.message).toBe('Failed to deliver email via Mailpit.');
      }
    });

    it('throws non-retryable error when Mailpit response is missing ID', async () => {
      responseHandler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' })); // missing ID
      };

      const adapter = createAdapter();
      try {
        await adapter.send({
          to: 'learner@example.com',
          subject: 'Test',
          text: 'Text',
        });
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(MailDeliveryError);
        const error = err as MailDeliveryError;
        expect(error.retryable).toBe(false);
      }
    });
  });

  describe('header injection and PII protection (P6)', () => {
    it('throws on CRLF in subject and DOES NOT call stub server', async () => {
      const adapter = createAdapter();
      await expect(
        adapter.send({
          to: 'learner@example.com',
          subject: 'Attack\r\nBcc: evil@hacker.com',
          text: 'Body',
        }),
      ).rejects.toThrow(MailDeliveryError);

      expect(receivedRequests).toHaveLength(0);
    });

    it('throws on CRLF in from address and DOES NOT call stub server', async () => {
      const badAdapter = createAdapter(
        'noreply@example.com\r\nBcc: evil@hacker.com',
      );
      await expect(
        badAdapter.send({
          to: 'learner@example.com',
          subject: 'Subject',
          text: 'Body',
        }),
      ).rejects.toThrow(MailDeliveryError);

      expect(receivedRequests).toHaveLength(0);
    });

    it('ensures error.message never leaks recipient address', async () => {
      responseHandler = (_req, res) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Crash' }));
      };

      const sensitiveRecipient = 'private.user.7788@domain.vn';
      const adapter = createAdapter();
      try {
        await adapter.send({
          to: sensitiveRecipient,
          subject: 'Confidential Subject',
          text: 'Secret OTP 123456',
        });
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(MailDeliveryError);
        const error = err as MailDeliveryError;
        expect(error.message).not.toContain(sensitiveRecipient);
        expect(error.message).not.toContain('Confidential Subject');
        expect(error.message).not.toContain('123456');
      }
    });
  });
});
