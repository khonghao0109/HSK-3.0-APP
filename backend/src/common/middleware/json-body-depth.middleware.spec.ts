import { BadRequestException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import {
  JsonBodyDepthMiddleware,
  REQUEST_JSON_MAX_DEPTH,
  exceedsJsonDepth,
} from './json-body-depth.middleware';

function nest(
  depth: number,
  container: 'object' | 'array' = 'object',
): unknown {
  let value: unknown = 'leaf';
  for (let level = 0; level < depth; level += 1) {
    value = container === 'object' ? { nested: value } : [value];
  }
  return value;
}

function runMiddleware(body: unknown): { error: unknown; nextCalls: number } {
  const middleware = new JsonBodyDepthMiddleware();
  let nextCalls = 0;
  const next: NextFunction = () => {
    nextCalls += 1;
  };
  try {
    middleware.use({ body } as Request, {} as Response, next);
    return { error: null, nextCalls };
  } catch (error: unknown) {
    return { error, nextCalls };
  }
}

describe('JSON body depth guard', () => {
  it('accepts ordinary request bodies', () => {
    for (const body of [
      undefined,
      null,
      'text',
      42,
      {},
      [],
      { answer: { optionId: 'tone-a' }, durationSeconds: 7 },
      { rows: [{ exercise: { content: { blocks: [{ value: 'a' }] } } }] },
      nest(REQUEST_JSON_MAX_DEPTH),
      nest(REQUEST_JSON_MAX_DEPTH, 'array'),
    ]) {
      expect(exceedsJsonDepth(body, REQUEST_JSON_MAX_DEPTH)).toBe(false);
      expect(runMiddleware(body)).toEqual({ error: null, nextCalls: 1 });
    }
  });

  it('rejects a body nested past the bound without recursing', () => {
    // Far past the depth where a recursive walk throws RangeError.
    for (const body of [
      nest(REQUEST_JSON_MAX_DEPTH + 1),
      nest(REQUEST_JSON_MAX_DEPTH + 1, 'array'),
      nest(200_000),
      { safe: 'value', deep: nest(500_000, 'array') },
    ]) {
      expect(exceedsJsonDepth(body, REQUEST_JSON_MAX_DEPTH)).toBe(true);
      const outcome = runMiddleware(body);
      expect(outcome.nextCalls).toBe(0);
      expect(outcome.error).toBeInstanceOf(BadRequestException);
      expect((outcome.error as BadRequestException).message).toBe(
        'Payload exceeds maximum nesting depth of 32.',
      );
    }
  });

  it('measures depth per branch, not per node count', () => {
    const wide = { items: Array.from({ length: 5_000 }, () => ({ a: 1 })) };

    expect(exceedsJsonDepth(wide, REQUEST_JSON_MAX_DEPTH)).toBe(false);
    expect(exceedsJsonDepth(wide, 2)).toBe(true);
    expect(exceedsJsonDepth({ a: { b: 1 } }, 2)).toBe(false);
    expect(exceedsJsonDepth({ a: { b: { c: 1 } } }, 2)).toBe(true);
  });
});
