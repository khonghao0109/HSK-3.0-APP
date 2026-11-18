import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { examAnswerInvalid } from './exam-errors';

/**
 * F2: an answer body carrying an own `__proto__` key is rejected before the
 * global ValidationPipe runs. class-transformer rebuilds the DTO with
 * `Object.assign`, which turns that key into a prototype assignment and drops
 * it from `Object.keys`, so by the time the service validates the answer the
 * attack is invisible. Rejecting the raw body keeps the documented
 * `400 EXAM_ANSWER_INVALID` (`field = answer`) contract and closes the
 * prototype-pollution seam for the two autosave routes only. The check is
 * body-wide: a batch carrying one such item fails as a whole (a merely deep
 * answer is still reported per item by the service).
 */
@Injectable()
export class ExamAnswerBodyPrototypeMiddleware implements NestMiddleware {
  use(request: Request, _response: Response, next: NextFunction): void {
    if (containsPrototypeKey(request.body)) {
      throw examAnswerInvalid('answer');
    }
    next();
  }
}

export function containsPrototypeKey(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object') continue;
    if (Array.isArray(current)) {
      pending.push(...(current as unknown[]));
      continue;
    }
    const record = current as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === '__proto__') return true;
      pending.push(record[key]);
    }
  }
  return false;
}
