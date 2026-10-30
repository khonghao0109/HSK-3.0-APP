import type { Prisma } from '@prisma/client';

import {
  decideRecoveredAnswerConflict,
  isSameExamAnswerRequest,
} from './exam-answer-replay';

/**
 * F6: when the unique-key fallback in `saveAnswer` re-reads committed state,
 * an existing event for the same idempotency key with a different body must be
 * reported as a reused key, not as a version conflict (TL-123).
 */
function event(
  type: string,
  metadata: Prisma.JsonValue,
): { type: string; metadata: Prisma.JsonValue } {
  return { type, metadata };
}

describe('exam answer replay ledger', () => {
  const hash = 'b'.repeat(64);

  it('recognises the same autosaved request', () => {
    expect(
      isSameExamAnswerRequest(
        event('autosaved', { questionKey: 'q1', bodySha256: hash }),
        'q1',
        hash,
      ),
    ).toBe(true);
  });

  it('rejects a different question, body, event type or unusable hash', () => {
    const stored = event('autosaved', { questionKey: 'q1', bodySha256: hash });
    expect(isSameExamAnswerRequest(stored, 'q2', hash)).toBe(false);
    expect(isSameExamAnswerRequest(stored, 'q1', 'c'.repeat(64))).toBe(false);
    expect(
      isSameExamAnswerRequest(
        event('started', { questionKey: 'q1' }),
        'q1',
        hash,
      ),
    ).toBe(false);
    expect(isSameExamAnswerRequest(stored, 'q1', null)).toBe(false);
    expect(isSameExamAnswerRequest(null, 'q1', hash)).toBe(false);
  });

  it('decides replay vs reused key vs version conflict', () => {
    const same = event('autosaved', { questionKey: 'q1', bodySha256: hash });
    const other = event('autosaved', {
      questionKey: 'q1',
      bodySha256: 'd'.repeat(64),
    });

    expect(
      decideRecoveredAnswerConflict({
        event: same,
        questionKey: 'q1',
        bodySha256: hash,
        rowExists: true,
      }),
    ).toBe('replay');
    expect(
      decideRecoveredAnswerConflict({
        event: same,
        questionKey: 'q1',
        bodySha256: hash,
        rowExists: false,
      }),
    ).toBe('version_conflict');
    expect(
      decideRecoveredAnswerConflict({
        event: other,
        questionKey: 'q1',
        bodySha256: hash,
        rowExists: true,
      }),
    ).toBe('key_reused');
    expect(
      decideRecoveredAnswerConflict({
        event: null,
        questionKey: 'q1',
        bodySha256: hash,
        rowExists: true,
      }),
    ).toBe('version_conflict');
  });
});
