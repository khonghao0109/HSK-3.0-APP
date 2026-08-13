import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, Server } from 'node:http';

import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { MediaObservabilityService } from './media-observability.service';

const METRICS_PATH = '/metrics';
const METRICS_RESPONSE_TIMEOUT_MS = 4_750;
const METRICS_RESPONSE_MAX_BYTES = 256 * 1024;

@Injectable()
export class MediaMetricsServer implements OnApplicationShutdown {
  private readonly logger = new Logger(MediaMetricsServer.name);
  private readonly bearerTokenHashes: Buffer[];
  private readonly host: string;
  private readonly configuredPort: number;
  private server: Server | undefined;
  private boundPort: number | undefined;

  constructor(
    private readonly metrics: MediaObservabilityService,
    config: ConfigService,
  ) {
    this.bearerTokenHashes = config
      .getOrThrow<string[]>('media.metricsBearerTokens')
      .map(hashToken);
    this.host = config.getOrThrow<string>('media.metricsHost');
    this.configuredPort = config.getOrThrow<number>('media.metricsPort');
  }

  get port(): number {
    if (this.boundPort === undefined) {
      throw new Error('Media metrics server is not listening.');
    }
    return this.boundPort;
  }

  async listen(): Promise<void> {
    if (this.server) return;
    const server = createServer(
      { maxHeaderSize: 8 * 1024 },
      (request, response) => {
        const contentLength = Number(request.headers['content-length'] ?? 0);
        const hasBody =
          request.headers['transfer-encoding'] !== undefined ||
          !Number.isFinite(contentLength) ||
          contentLength > 0;
        if (hasBody) {
          response.writeHead(413, {
            Connection: 'close',
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
          });
          response.end('Request body is not allowed.\n');
          return;
        }
        void this.handle(
          request.method,
          request.url,
          request.headers.authorization,
        )
          .then((result) => {
            response.writeHead(result.statusCode, result.headers);
            response.end(result.body);
          })
          .catch(() => {
            response.writeHead(503, {
              'Cache-Control': 'no-store',
              'Content-Type': 'text/plain; charset=utf-8',
              'X-Content-Type-Options': 'nosniff',
            });
            response.end('Metrics are temporarily unavailable.\n');
          });
      },
    );
    server.requestTimeout = 5_000;
    server.headersTimeout = 6_000;
    server.keepAliveTimeout = 5_000;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.configuredPort, this.host);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      await closeServer(server);
      throw new Error('Media metrics listener did not bind a TCP port.');
    }
    this.server = server;
    this.boundPort = address.port;
    this.logger.log(
      `Media metrics listener started on ${this.host}:${address.port}${METRICS_PATH}`,
    );
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.boundPort = undefined;
    if (server) await closeServer(server);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }

  private async handle(
    method: string | undefined,
    url: string | undefined,
    authorization: string | undefined,
  ): Promise<MetricsResponse> {
    const headers = {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    };
    if (method !== 'GET' || url !== METRICS_PATH) {
      return { statusCode: 404, headers, body: 'Not Found\n' };
    }
    if (!hasValidBearer(authorization, this.bearerTokenHashes)) {
      return { statusCode: 403, headers, body: 'Forbidden\n' };
    }
    const body = await withDeadline(
      this.metrics.render(),
      METRICS_RESPONSE_TIMEOUT_MS,
    );
    if (Buffer.byteLength(body, 'utf8') > METRICS_RESPONSE_MAX_BYTES) {
      throw new Error('Metrics response exceeded its fixed size budget.');
    }
    return { statusCode: 200, headers, body };
  }
}

type MetricsResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

function hasValidBearer(
  authorization: string | undefined,
  trustedHashes: readonly Buffer[],
): boolean {
  if (!authorization?.startsWith('Bearer ')) return false;
  const value = authorization.slice(7);
  if (value.length === 0) return false;
  const received = hashToken(value);
  return trustedHashes.reduce(
    (matched, trusted) => timingSafeEqual(received, trusted) || matched,
    false,
  );
}

function hashToken(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function withDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Metrics response exceeded its time budget.')),
      timeoutMs,
    );
    timeout.unref();
    void operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error('Metrics failed.'));
      },
    );
  });
}
