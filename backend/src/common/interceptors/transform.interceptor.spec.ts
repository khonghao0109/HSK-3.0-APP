import {
  type CallHandler,
  Controller,
  type ExecutionContext,
  Get,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';

import { RawResponse } from '../decorators/raw-response.decorator';
import {
  TransformInterceptor,
  toSuccessEnvelope,
} from './transform.interceptor';

const REQUEST_ID = '7d1f4a9e-3b2c-4d5e-8f60-1a2b3c4d5e6f';
const NOW = new Date('2026-09-14T05:00:00.000Z');
const META = { requestId: REQUEST_ID, timestamp: NOW.toISOString() };

@Controller()
class ProbeController {
  @Get()
  json() {
    return { ok: true };
  }

  @Get('content')
  @RawResponse()
  content() {
    return 'raw';
  }
}

describe('TransformInterceptor', () => {
  describe('toSuccessEnvelope', () => {
    it.each([
      ['an object', { user: { id: 1 }, accessToken: 't' }],
      ['an array', [{ hanzi: '你' }]],
      ['a string', 'Learning module working'],
      ['zero', 0],
    ])('wraps %s as data', (_, body) => {
      expect(toSuccessEnvelope(body, REQUEST_ID, NOW)).toEqual({
        success: true,
        data: body,
        meta: META,
      });
    });

    it('turns an empty handler result into null data', () => {
      expect(toSuccessEnvelope(undefined, REQUEST_ID, NOW)).toEqual({
        success: true,
        data: null,
        meta: META,
      });
    });

    it('unwraps a service envelope instead of nesting success', () => {
      expect(
        toSuccessEnvelope({ success: true, data: [1, 2] }, REQUEST_ID, NOW),
      ).toEqual({ success: true, data: [1, 2], meta: META });
    });

    it('moves service pagination into meta.pagination', () => {
      const pagination = { page: 2, limit: 20, total: 41, totalPages: 3 };

      expect(
        toSuccessEnvelope(
          { success: true, data: [], meta: pagination },
          REQUEST_ID,
          NOW,
        ),
      ).toEqual({
        success: true,
        data: [],
        meta: { ...META, pagination },
      });
    });

    it('keeps an object that merely has a success flag as data', () => {
      const body = { success: true, database: 'connected' };

      expect(toSuccessEnvelope(body, REQUEST_ID, NOW).data).toBe(body);
    });

    it.each([
      ['an extra field', { success: true, data: 1, message: 'hi' }],
      ['non-pagination meta', { success: true, data: 1, meta: { next: 'x' } }],
      [
        'pagination with extra keys',
        {
          success: true,
          data: 1,
          meta: { page: 1, limit: 1, total: 1, totalPages: 1, cursor: 'x' },
        },
      ],
    ])('fails loudly on a service envelope with %s', (_, body) => {
      expect(() => toSuccessEnvelope(body, REQUEST_ID, NOW)).toThrow(
        'Handler envelope carries unsupported fields.',
      );
    });
  });

  describe('intercept', () => {
    const interceptor = new TransformInterceptor(new Reflector());

    const run = async (
      handler: keyof ProbeController,
      body: unknown,
      response: Record<string, unknown> = {},
      type = 'http',
    ) => {
      const setHeader = jest.fn();
      const context = {
        getType: () => type,
        getHandler: () => ProbeController.prototype[handler],
        getClass: () => ProbeController,
        switchToHttp: () => ({
          getRequest: () => ({ headers: { 'x-request-id': REQUEST_ID } }),
          getResponse: () => ({ setHeader, headersSent: false, ...response }),
        }),
      } as unknown as ExecutionContext;
      const next: CallHandler = { handle: () => of(body) };
      const result: unknown = await lastValueFrom(
        interceptor.intercept(context, next),
      );
      return { result, setHeader };
    };

    it('wraps JSON handler results and echoes the request id', async () => {
      const { result, setHeader } = await run('json', { ok: true });

      expect(result).toMatchObject({
        success: true,
        data: { ok: true },
        meta: { requestId: REQUEST_ID, timestamp: expect.any(String) },
      });
      expect(setHeader).toHaveBeenCalledWith('X-Request-ID', REQUEST_ID);
    });

    it('leaves routes marked @RawResponse() untouched', async () => {
      await expect(run('content', 'raw')).resolves.toMatchObject({
        result: 'raw',
      });
    });

    it.each([
      ['a StreamableFile', new StreamableFile(Buffer.from('mp3'))],
      ['a Buffer', Buffer.from('png')],
    ])('passes %s through unwrapped', async (_, body) => {
      const { result } = await run('json', body);

      expect(result).toBe(body);
    });

    it('does nothing once a handler has written the response itself', async () => {
      const { result } = await run('json', undefined, { headersSent: true });

      expect(result).toBeUndefined();
    });

    it('ignores non-HTTP contexts', async () => {
      const { result } = await run('json', { ok: true }, {}, 'rpc');

      expect(result).toEqual({ ok: true });
    });
  });
});
