import { markAttemptTimedOut } from './exam-attempt-timeout';

/**
 * F1: `in_progress -> timed_out` is a one-way, exactly-once transition. The
 * conditional update is the guard: only the transaction whose `count` is 1
 * writes the `timed_out` event, so a start racing a lazy timeout cannot append
 * a second terminal event.
 */
type CreateCall = { data: Record<string, unknown> };
type UpdateCall = {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
};

function writer(count: number): {
  updates: UpdateCall[];
  events: CreateCall[];
  tx: Parameters<typeof markAttemptTimedOut>[0];
} {
  const updates: UpdateCall[] = [];
  const events: CreateCall[] = [];
  return {
    updates,
    events,
    tx: {
      examAttempt: {
        updateMany: (input: UpdateCall) => {
          updates.push(input);
          return Promise.resolve({ count });
        },
      },
      examAttemptEvent: {
        create: (input: CreateCall) => {
          events.push(input);
          return Promise.resolve({ id: 1 });
        },
      },
    },
  };
}

describe('markAttemptTimedOut', () => {
  const input = {
    attemptId: 42,
    expiresAt: new Date('2026-10-27T10:30:00.000Z'),
    occurredAt: new Date('2026-10-27T10:31:00.000Z'),
    reason: 'expired_on_start' as const,
  };

  it('writes the event only when the conditional update wins', async () => {
    const { tx, updates, events } = writer(1);

    await expect(markAttemptTimedOut(tx, input)).resolves.toBe(true);

    expect(updates).toEqual([
      {
        where: { id: 42, status: 'in_progress' },
        data: {
          status: 'timed_out',
          submittedAt: input.expiresAt,
          remainingSeconds: 0,
        },
      },
    ]);
    expect(events).toEqual([
      {
        data: {
          attemptId: 42,
          type: 'timed_out',
          metadata: { reason: 'expired_on_start' },
          occurredAt: input.occurredAt,
        },
      },
    ]);
  });

  it('writes nothing when the attempt is already closed', async () => {
    const { tx, updates, events } = writer(0);

    await expect(markAttemptTimedOut(tx, input)).resolves.toBe(false);

    expect(updates).toHaveLength(1);
    expect(events).toEqual([]);
  });
});
