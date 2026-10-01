import type { Request, Response } from 'express';

import {
  isAcceptedRequestId,
  RequestIdMiddleware,
  resolveRequestId,
} from './request-id.middleware';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function http(requestId?: string | string[]) {
  const request = {
    headers: requestId === undefined ? {} : { 'x-request-id': requestId },
  } as unknown as Request;
  const setHeader = jest.fn();
  const response = { setHeader, headersSent: false } as unknown as Response;
  return { request, response, setHeader };
}

describe('request id', () => {
  it.each([
    ['a UUID from the BFF', '7d1f4a9e-3b2c-4d5e-8f60-1a2b3c4d5e6f'],
    ['an upper-case UUID', '7D1F4A9E-3B2C-4D5E-8F60-1A2B3C4D5E6F'],
    ['an nginx $request_id', '0123456789abcdef0123456789abcdef'],
  ])('keeps %s and echoes it', (_, incoming) => {
    const { request, response, setHeader } = http(incoming);

    expect(resolveRequestId(request, response)).toBe(incoming);
    expect(setHeader).toHaveBeenCalledWith('X-Request-ID', incoming);
    expect(request.headers['x-request-id']).toBe(incoming);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['free text', 'hello'],
    ['header injection', 'abc\r\nSet-Cookie: x=1'],
    ['markup', '<script>alert(1)</script>'],
    ['a 33-hex value', '0123456789abcdef0123456789abcdef0'],
    ['a UUID with a suffix', '7d1f4a9e-3b2c-4d5e-8f60-1a2b3c4d5e6f.x'],
    ['a repeated header', ['7d1f4a9e-3b2c-4d5e-8f60-1a2b3c4d5e6f', 'b']],
  ])('replaces a %s id with a new UUIDv4', (_, incoming) => {
    const { request, response, setHeader } = http(incoming);

    const id = resolveRequestId(request, response);

    expect(id).toMatch(UUID_V4);
    expect(id).not.toBe(incoming);
    expect(setHeader).toHaveBeenCalledWith('X-Request-ID', id);
    // Handlers reading the header (CMS audit) see the echoed id.
    expect(request.headers['x-request-id']).toBe(id);
    expect(isAcceptedRequestId(incoming)).toBe(false);
  });

  it('assigns one id per request however often it is resolved', () => {
    const { request, response } = http();

    const first = resolveRequestId(request, response);

    expect(resolveRequestId(request)).toBe(first);
    expect(resolveRequestId(request, response)).toBe(first);
  });

  it('does not touch headers once the response has started', () => {
    const { request, setHeader } = http();
    const response = { setHeader, headersSent: true } as unknown as Response;

    expect(resolveRequestId(request, response)).toMatch(UUID_V4);
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('sets the id before calling the next handler', () => {
    const { request, response, setHeader } = http();
    const next = jest.fn(() => {
      expect(setHeader).toHaveBeenCalledTimes(1);
    });

    new RequestIdMiddleware().use(request, response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
