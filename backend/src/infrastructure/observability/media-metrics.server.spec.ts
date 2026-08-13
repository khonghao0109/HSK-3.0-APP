import { request } from 'node:http';

import { MediaMetricsServer } from './media-metrics.server';

describe('MediaMetricsServer', () => {
  it('serves only the private metrics path with exact bearer authentication', async () => {
    const currentToken = 'm'.repeat(32);
    const previousToken = 'p'.repeat(32);
    const metrics = { render: jest.fn().mockResolvedValue('metric 1\n') };
    const config = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'media.metricsBearerTokens') {
          return [currentToken, previousToken];
        }
        if (key === 'media.metricsHost') return '127.0.0.1';
        if (key === 'media.metricsPort') return 0;
        throw new Error(`Unexpected config: ${key}`);
      }),
    };
    const server = new MediaMetricsServer(metrics as never, config as never);
    await server.listen();
    try {
      const unauthorized = await send(server.port, '/metrics');
      expect(unauthorized.statusCode).toBe(403);
      expect(unauthorized.body).not.toContain(currentToken);

      for (const malformed of [
        currentToken,
        `Basic ${currentToken}`,
        'Bearer',
        'Bearer ',
        `bearer ${currentToken}`,
        `Bearer ${currentToken} trailing`,
      ]) {
        const rejected = await send(server.port, '/metrics', malformed);
        expect(rejected.statusCode).toBe(403);
        expect(rejected.body).toBe('Forbidden\n');
        expect(rejected.body).not.toContain(currentToken);
        expect(rejected.body).not.toContain(previousToken);
      }

      for (const [method, path] of [
        ['GET', '/api/v1/internal/metrics/media'],
        ['HEAD', '/metrics'],
        ['POST', '/metrics'],
        ['GET', '/metrics/'],
        ['GET', '//metrics'],
        ['GET', '/METRICS'],
        ['GET', '/metrics;probe'],
        ['GET', '/%2fmetrics'],
        ['GET', '/metrics?probe=1'],
      ]) {
        const rejected = await send(
          server.port,
          path,
          `Bearer ${currentToken}`,
          method,
        );
        expect(rejected.statusCode).toBe(404);
      }

      const authorized = await send(
        server.port,
        '/metrics',
        `Bearer ${currentToken}`,
      );
      expect(authorized).toMatchObject({ statusCode: 200, body: 'metric 1\n' });
      expect(authorized.headers['cache-control']).toBe('no-store');

      const rotated = await send(
        server.port,
        '/metrics',
        `Bearer ${previousToken}`,
      );
      expect(rotated).toMatchObject({ statusCode: 200, body: 'metric 1\n' });

      metrics.render.mockRejectedValueOnce(
        new Error(`database failed with token ${currentToken}`),
      );
      const failed = await send(
        server.port,
        '/metrics',
        `Bearer ${currentToken}`,
      );
      expect(failed.statusCode).toBe(503);
      expect(failed.body).toBe('Metrics are temporarily unavailable.\n');
      expect(failed.body).not.toContain(currentToken);

      metrics.render.mockResolvedValueOnce('x'.repeat(256 * 1024 + 1));
      const oversized = await send(
        server.port,
        '/metrics',
        `Bearer ${currentToken}`,
      );
      expect(oversized.statusCode).toBe(503);
      expect(oversized.body).toBe('Metrics are temporarily unavailable.\n');

      const bodyRejected = await send(
        server.port,
        '/metrics',
        `Bearer ${currentToken}`,
        'GET',
        'unexpected',
      );
      expect(bodyRejected.statusCode).toBe(413);
    } finally {
      await server.close();
    }
  });
});

function send(
  port: number,
  path: string,
  authorization?: string,
  method = 'GET',
  body?: string,
) {
  return new Promise<{
    body: string;
    headers: Record<string, string | string[] | undefined>;
    statusCode: number | undefined;
  }>((resolve, reject) => {
    const operation = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          ...(authorization ? { authorization } : {}),
          ...(body ? { 'content-length': Buffer.byteLength(body) } : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            headers: response.headers,
            statusCode: response.statusCode,
          }),
        );
      },
    );
    operation.on('error', reject);
    operation.end(body);
  });
}
