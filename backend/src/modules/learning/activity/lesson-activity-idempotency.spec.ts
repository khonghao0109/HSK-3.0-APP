import { BadRequestException } from '@nestjs/common';

import {
  buildActivityRequestHash,
  parseIdempotencyKey,
} from './lesson-activity-idempotency';

describe('Lesson Activity idempotency contract', () => {
  it('accepts bounded client keys and rejects ambiguous/unsafe keys', () => {
    expect(parseIdempotencyKey('activity_01.ABC-xyz')).toBe(
      'activity_01.ABC-xyz',
    );
    for (const value of [undefined, '', 'has space', 'a'.repeat(129)]) {
      expect(() => parseIdempotencyKey(value)).toThrow(BadRequestException);
    }
  });

  it('uses canonical semantic hashing instead of object insertion order', () => {
    expect(
      buildActivityRequestHash({ exerciseId: 1, answer: { b: 2, a: 1 } }),
    ).toBe(buildActivityRequestHash({ answer: { a: 1, b: 2 }, exerciseId: 1 }));
    expect(
      buildActivityRequestHash({ exerciseId: 1, answer: { a: 1 } }),
    ).not.toBe(buildActivityRequestHash({ exerciseId: 2, answer: { a: 1 } }));
  });
});
