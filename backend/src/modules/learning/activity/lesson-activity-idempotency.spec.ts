import { BadRequestException } from '@nestjs/common';

import {
  IDEMPOTENCY_KEY_TTL_MS,
  assertIdempotencyKeyWithinTtl,
  buildActivityRequestHash,
  isIdempotencyKeyExpired,
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

  it('replays only inside the 24-hour key window', () => {
    const now = new Date('2026-09-25T12:00:00.000Z');
    const withinWindow = [
      now,
      new Date(now.getTime() - 1),
      new Date(now.getTime() - IDEMPOTENCY_KEY_TTL_MS),
    ];
    const expired = [
      new Date(now.getTime() - IDEMPOTENCY_KEY_TTL_MS - 1),
      new Date(now.getTime() - 7 * IDEMPOTENCY_KEY_TTL_MS),
    ];

    expect(IDEMPOTENCY_KEY_TTL_MS).toBe(86_400_000);
    for (const storedAt of withinWindow) {
      expect(isIdempotencyKeyExpired(storedAt, now)).toBe(false);
      expect(() => assertIdempotencyKeyWithinTtl(storedAt, now)).not.toThrow();
    }
    for (const storedAt of expired) {
      expect(isIdempotencyKeyExpired(storedAt, now)).toBe(true);
      expect(() => assertIdempotencyKeyWithinTtl(storedAt, now)).toThrow(
        new BadRequestException(
          'Idempotency-Key has expired. Please use a fresh key.',
        ),
      );
    }
  });

  it('treats a stored timestamp in the future as still replayable', () => {
    const now = new Date('2026-09-25T12:00:00.000Z');
    const clockSkew = new Date(now.getTime() + 5_000);

    expect(isIdempotencyKeyExpired(clockSkew, now)).toBe(false);
  });

  it('rejects an over-nested answer as a bad request, not a server fault', () => {
    let deepAnswer: unknown = 'leaf';
    for (let level = 0; level < 5_000; level += 1) {
      deepAnswer = { nested: deepAnswer };
    }

    expect(() => buildActivityRequestHash({ answer: deepAnswer })).toThrow(
      BadRequestException,
    );
    expect(() => buildActivityRequestHash({ answer: deepAnswer })).toThrow(
      /maximum nesting depth of 16/u,
    );
    expect(() =>
      buildActivityRequestHash({ answer: { optionId: 'tone-a' } }),
    ).not.toThrow();
  });
});
