import {
  BadRequestException,
  Injectable,
  type NestMiddleware,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Nest's ValidationPipe (class-transformer) walks the parsed body recursively
 * before any validator runs, so a deeply nested payload throws
 * `RangeError: Maximum call stack size exceeded` and surfaces as a 500. This
 * middleware runs before the pipes and rejects such a body with a 400 using an
 * explicit stack, so the check itself cannot exhaust the call stack (D-01).
 *
 * The bound is deliberately looser than CANONICAL_JSON_MAX_DEPTH: it is the
 * edge backstop for every route, while each payload contract keeps its own
 * stricter limit (LESSON_EXERCISE_AUTHORING_LIMITS.maxDepth, canonical JSON).
 */
export const REQUEST_JSON_MAX_DEPTH = 32;

export function exceedsJsonDepth(value: unknown, maxDepth: number): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [
    { value, depth: 0 },
  ];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    const children = childValues(current.value);
    if (children === null) continue;
    if (current.depth + 1 > maxDepth) return true;
    for (const child of children) {
      pending.push({ value: child, depth: current.depth + 1 });
    }
  }
  return false;
}

function childValues(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value as unknown[];
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>);
  }
  return null;
}

@Injectable()
export class JsonBodyDepthMiddleware implements NestMiddleware {
  use(request: Request, _response: Response, next: NextFunction): void {
    if (exceedsJsonDepth(request.body, REQUEST_JSON_MAX_DEPTH)) {
      throw new BadRequestException(
        `Payload exceeds maximum nesting depth of ${String(REQUEST_JSON_MAX_DEPTH)}.`,
      );
    }
    next();
  }
}
