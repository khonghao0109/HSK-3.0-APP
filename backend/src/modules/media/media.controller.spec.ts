import { ForbiddenException, HttpException } from '@nestjs/common';
import express from 'express';
import type { Request, Response } from 'express';

import type { MediaAccessService } from './media-access.service';
import { MediaController } from './media.controller';

describe('MediaController signed content request target', () => {
  const query = { expires: 1_800_000_000, signature: 'a'.repeat(64) };

  it('forwards the exact raw canonical path and method without signed query data', async () => {
    const body = Buffer.from('media');
    const readSignedObject = jest.fn().mockResolvedValue({
      body,
      contentType: 'image/png',
      checksum: 'b'.repeat(64),
      size: body.length,
    });
    const controller = new MediaController({
      readSignedObject,
    } as unknown as MediaAccessService);
    const setHeader = jest.fn();
    const end = jest.fn();
    const response = { setHeader, end } as unknown as Response;

    await controller.getContent(
      expressRequest({
        method: 'GET',
        originalUrl:
          `/api/v1/media/41/content?expires=${query.expires}` +
          `&signature=${query.signature}`,
      }),
      41,
      query,
      response,
    );

    expect(readSignedObject).toHaveBeenCalledWith(
      41,
      query.expires,
      query.signature,
      { method: 'GET', path: '/api/v1/media/41/content' },
    );
    expect(setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    );
    expect(end).toHaveBeenCalledWith(body);
  });

  it.each([
    ['HEAD', '/api/v1/media/41/content'],
    ['GET', '/api/v1/media/41/content/'],
    ['GET', '/API/v1/media/41/content'],
    ['GET', '/api/v1/media//41/content'],
    ['GET', '/api/v1/media/41/content;download'],
    ['GET', '/api/v1/media%2F41/content'],
  ])(
    'does not canonicalize %s %s before verification',
    async (method, path) => {
      const readSignedObject = jest
        .fn()
        .mockRejectedValue(new ForbiddenException('Invalid grant.'));
      const controller = new MediaController({
        readSignedObject,
      } as unknown as MediaAccessService);

      await expect(
        controller.getContent(
          {
            method,
            originalUrl: `${path}?expires=${query.expires}&signature=${query.signature}`,
          } as Request,
          41,
          query,
          {} as Response,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(readSignedObject).toHaveBeenCalledWith(
        41,
        query.expires,
        query.signature,
        { method, path },
      );
    },
  );
});

describe('MediaController Range responses', () => {
  const query = { expires: 1_800_000_000, signature: 'a'.repeat(64) };
  const body = Buffer.from('0123456789');

  async function serve(range?: string) {
    const readSignedObject = jest.fn().mockResolvedValue({
      body,
      contentType: 'audio/mpeg',
      checksum: 'b'.repeat(64),
      size: body.length,
    });
    const controller = new MediaController({ readSignedObject } as never);
    const headers = new Map<string, string>();
    const sent: { status: number; body?: Buffer } = { status: 200 };
    const response = {
      setHeader: (name: string, value: string) => headers.set(name, value),
      status: (code: number) => {
        sent.status = code;
        return response;
      },
      end: (chunk: Buffer) => {
        sent.body = chunk;
      },
    };
    const outcome = await controller
      .getContent(
        expressRequest({
          method: 'GET',
          originalUrl: '/api/v1/media/41/content',
          headers: range === undefined ? {} : { range },
        }),
        41,
        query,
        response as never,
      )
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    return { headers, sent, outcome };
  }

  it.each([
    ['bytes=0-1', '0-1', '01'],
    ['bytes=-3', '7-9', '789'],
    ['bytes=8-', '8-9', '89'],
    ['bytes=5-100', '5-9', '56789'],
  ])('serves %s as 206 %s', async (range, span, bytes) => {
    const { headers, sent, outcome } = await serve(range);

    expect(outcome).toBeUndefined();
    expect(sent.status).toBe(206);
    expect(headers.get('Content-Range')).toBe(`bytes ${span}/10`);
    expect(headers.get('Content-Length')).toBe(String(bytes.length));
    expect(sent.body?.toString()).toBe(bytes);
    expect(headers.get('Accept-Ranges')).toBe('bytes');
    expect(headers.get('Content-Type')).toBe('audio/mpeg');
    expect(headers.get('Cache-Control')).toBe('private, no-store');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('Content-Disposition')).toBe('inline');
  });

  it.each(['bytes=10-20', 'bytes=a-', 'bytes=5-2', 'bytes=-0'])(
    'rejects unsatisfiable %s with 416 and no media Content-Type',
    async (range) => {
      const { headers, sent, outcome } = await serve(range);

      expect(outcome).toBeInstanceOf(HttpException);
      expect((outcome as HttpException).getStatus()).toBe(416);
      expect(headers.get('Content-Range')).toBe('bytes */10');
      expect(headers.get('Cache-Control')).toBe('private, no-store');
      expect(headers.has('Content-Type')).toBe(false);
      expect(headers.has('Content-Length')).toBe(false);
      expect(sent.body).toBeUndefined();
    },
  );

  it.each([
    ['no Range header', undefined],
    ['a malformed header', 'garbage'],
    ['several ranges', 'bytes=0-1,3-4'],
    ['another unit', 'items=0-1'],
    ['another unit out of bounds', 'items=20-30'],
  ])('serves the whole file with 200 for %s', async (_label, range) => {
    const { headers, sent, outcome } = await serve(range);

    expect(outcome).toBeUndefined();
    expect(sent.status).toBe(200);
    expect(headers.has('Content-Range')).toBe(false);
    expect(headers.get('Content-Length')).toBe('10');
    expect(headers.get('Accept-Ranges')).toBe('bytes');
    expect(sent.body).toBe(body);
  });

  it('rejects an invalid grant with 403 before looking at Range', async () => {
    const readSignedObject = jest
      .fn()
      .mockRejectedValue(new ForbiddenException('Invalid grant.'));
    const controller = new MediaController({ readSignedObject } as never);
    const setHeader = jest.fn();

    await expect(
      controller.getContent(
        expressRequest({
          method: 'GET',
          originalUrl: '/api/v1/media/41/content',
          headers: { range: 'bytes=10-20' },
        }),
        41,
        query,
        { setHeader } as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(setHeader).not.toHaveBeenCalled();
  });
});

/** A request backed by Express's prototype so `req.range()` is the real parser. */
function expressRequest(fields: {
  method: string;
  originalUrl: string;
  headers?: Record<string, string>;
}): Request {
  const request: Request = Object.create(express.request);
  return Object.assign(request, { headers: {}, ...fields });
}
