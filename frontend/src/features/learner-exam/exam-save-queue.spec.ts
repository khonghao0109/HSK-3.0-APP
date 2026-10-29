import { describe, expect, it, vi } from 'vitest';

import {
  createExamSaveQueue,
  type AttemptRows,
  type BatchResponse,
  type ExamQueueDeps,
  type ExamQueueEvents,
  type ExamQueueTransport,
  type SaveRequest,
  type SaveResponse,
} from './exam-save-queue';

type Fake = {
  transport: ExamQueueTransport;
  events: ExamQueueEvents;
  deps: ExamQueueDeps;
  timers: Array<{ handler: () => void; ms: number; id: number }>;
  online: { value: boolean };
  runTimers: () => Promise<void>;
};

let uuidCounter = 0;

function fake(options: {
  saveOne?: (key: string, body: SaveRequest) => Promise<SaveResponse>;
  saveBatch?: (
    items: Array<{ questionKey: string } & SaveRequest>,
  ) => Promise<BatchResponse>;
  readAttempt?: () => Promise<AttemptRows>;
}): Fake {
  uuidCounter = 0;
  const timers: Fake['timers'] = [];
  const online = { value: true };
  const queueDeps: ExamQueueDeps = {
    randomUUID: () => {
      uuidCounter += 1;
      return `uuid-${String(uuidCounter)}`;
    },
    setTimeout: (handler, ms) => {
      const id = timers.length + 1;
      timers.push({ handler, ms, id });
      return id;
    },
    clearTimeout: (handle) => {
      const index = timers.findIndex((timer) => timer.id === handle);
      if (index >= 0) timers.splice(index, 1);
    },
    isOnline: () => online.value,
    now: () => 0,
  };
  const events: ExamQueueEvents = {
    onSaving: vi.fn(),
    onSaved: vi.fn(),
    onServerAnswer: vi.fn(),
    onConflictToast: vi.fn(),
    onInvalid: vi.fn(),
    onLocked: vi.fn(),
    onAuthLost: vi.fn(),
    onNotFound: vi.fn(),
    onRemainingSeconds: vi.fn(),
    onOffline: vi.fn(),
  };
  return {
    transport: {
      saveOne: options.saveOne ?? (async () => ({ kind: 'saved', version: 1 })),
      saveBatch:
        options.saveBatch ?? (async () => ({ kind: 'ok', results: [] })),
      readAttempt:
        options.readAttempt ??
        (async () => ({ answers: [], status: 'in_progress' })),
    },
    events,
    deps: queueDeps,
    timers,
    online,
    async runTimers() {
      const pending = [...timers];
      timers.length = 0;
      for (const timer of pending) timer.handler();
      await settle();
    },
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 40; index += 1) {
    await new Promise<void>((resolve) => resolve());
  }
}

const body = (answer: SaveRequest['answer'], isFlagged = false) => ({
  answer,
  isFlagged,
});

describe('exam save queue (TL-136)', () => {
  it('keeps one request in flight per question and sends the newest value next', async () => {
    const resolvers: Array<(value: SaveResponse) => void> = [];
    const calls: SaveRequest[] = [];
    const f = fake({
      saveOne: (_key, request) => {
        calls.push(request);
        return new Promise((resolve) => resolvers.push(resolve));
      },
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }));
    queue.setAnswer('q1', body({ choice: 'b' }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      answer: { choice: 'a' },
      idempotencyKey: 'uuid-1',
    });

    resolvers[0]?.({ kind: 'saved', version: 1 });
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      answer: { choice: 'b' },
      expectedVersion: 1,
    });
    expect(calls[1]?.idempotencyKey).not.toBe('uuid-1');
    resolvers[1]?.({ kind: 'saved', version: 2, remainingSeconds: 300 });
    await settle();
    expect(f.events.onRemainingSeconds).toHaveBeenCalledWith(300);
  });

  it('keeps the key across a network retry and changes it when the body changes', async () => {
    const calls: SaveRequest[] = [];
    let failFirst = true;
    const f = fake({
      saveOne: async (_key, request) => {
        calls.push(request);
        if (failFirst) {
          failFirst = false;
          return { kind: 'network' };
        }
        return { kind: 'saved', version: 1 };
      },
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ value: true }));
    await settle();
    expect(calls[0]?.idempotencyKey).toBe('uuid-1');
    expect(f.events.onOffline).toHaveBeenCalledWith(true);
    expect(queue.hasPending()).toBe(true);

    await f.runTimers();
    expect(calls[1]).toMatchObject({
      answer: { value: true },
      idempotencyKey: 'uuid-1',
    });
    expect(queue.hasPending()).toBe(false);
  });

  it('retries a reused idempotency key once with a fresh key', async () => {
    const calls: SaveRequest[] = [];
    const f = fake({
      saveOne: async (_key, request) => {
        calls.push(request);
        return calls.length === 1
          ? { kind: 'invalid', code: 'EXAM_IDEMPOTENCY_KEY_REUSED' }
          : { kind: 'saved', version: 1 };
      },
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }));
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.idempotencyKey).not.toBe(calls[0]?.idempotencyKey);
    expect(calls[1]?.expectedVersion).toBeNull();
    expect(f.events.onInvalid).not.toHaveBeenCalled();
  });

  it('marks invalid answers as failed without retrying', async () => {
    const f = fake({
      saveOne: async () => ({ kind: 'invalid', code: 'EXAM_ANSWER_INVALID' }),
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ order: ['t1'] }));
    await settle();
    expect(f.events.onInvalid).toHaveBeenCalledWith(
      'q1',
      'EXAM_ANSWER_INVALID',
    );
    expect(queue.hasPending()).toBe(false);
  });

  it('locks on expired and closed responses', async () => {
    for (const [response, expected] of [
      [{ kind: 'expired' } as SaveResponse, 'expired'],
      [{ kind: 'closed' } as SaveResponse, 'closed'],
    ] as const) {
      const f = fake({ saveOne: async () => response });
      const queue = createExamSaveQueue(f);
      queue.setAnswer('q1', body({ choice: 'a' }));
      await settle();
      expect(vi.mocked(f.events.onLocked).mock.calls[0]?.[0]).toBe(expected);
    }
  });

  it('resolves a single conflict with exactly one attempt read', async () => {
    const readAttempt = vi.fn(async () => ({
      answers: [
        {
          questionKey: 'q1',
          answer: { choice: 'b' } as const,
          isFlagged: false,
          version: 4,
        },
      ],
      status: 'in_progress',
    }));
    const f = fake({
      saveOne: async () => ({ kind: 'conflict' }),
      readAttempt,
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }));
    await settle();
    expect(readAttempt).toHaveBeenCalledTimes(1);
    expect(f.events.onServerAnswer).toHaveBeenCalledWith(
      'q1',
      { choice: 'b' },
      false,
      4,
    );
    expect(f.events.onConflictToast).toHaveBeenCalledWith('q1');
    expect(queue.questionVersion('q1')).toBe(4);
  });

  it('task1: a single PUT conflict keeps an edit typed while it was in flight', async () => {
    let resolveSave: ((value: SaveResponse) => void) | undefined;
    const calls: SaveRequest[] = [];
    const f = fake({
      saveOne: (_key, request) => {
        calls.push(request);
        return new Promise<SaveResponse>((resolve) => {
          resolveSave = resolve;
        });
      },
      readAttempt: async () => ({
        answers: [
          {
            questionKey: 'q1',
            answer: { choice: 'server' } as const,
            isFlagged: false,
            version: 7,
          },
        ],
        status: 'in_progress',
      }),
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }));
    await settle();
    expect(calls).toHaveLength(1);
    // The learner edits again while the rejected body is still in flight.
    queue.setAnswer('q1', body({ choice: 'b' }));
    await settle();
    resolveSave?.({ kind: 'conflict' });
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.answer).toEqual({ choice: 'b' });
    expect(calls[1]?.expectedVersion).toBe(7);
    expect(calls[1]?.idempotencyKey).not.toBe(calls[0]?.idempotencyKey);
    expect(f.events.onConflictToast).not.toHaveBeenCalled();
  });

  it('task1: a resolved conflict clears the unknown body before the next send', async () => {
    const calls: SaveRequest[] = [];
    let attempt = 0;
    const f = fake({
      saveOne: async (_key, request) => {
        calls.push(request);
        attempt += 1;
        if (attempt === 1) return { kind: 'network' };
        if (attempt === 2) return { kind: 'conflict' };
        return { kind: 'saved', version: 8 };
      },
      readAttempt: async () => ({
        answers: [
          {
            questionKey: 'q1',
            answer: { choice: 'server' } as const,
            isFlagged: false,
            version: 7,
          },
        ],
        status: 'in_progress',
      }),
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }));
    await settle();
    // `a` is unknown now; the learner edits to `b` and the retry replays `a`.
    queue.setAnswer('q1', body({ choice: 'b' }));
    await settle();
    await queue.retryNow();
    await settle();
    expect(calls).toHaveLength(3);
    expect(calls[1]?.answer).toEqual({ choice: 'a' });
    // The replayed body is settled by the conflict: `b` must be next, not `a`.
    expect(calls[2]?.answer).toEqual({ choice: 'b' });
    expect(calls[2]?.expectedVersion).toBe(7);
  });

  it('task1: a single PUT conflict without a newer edit toasts and drops pending', async () => {
    const f = fake({
      saveOne: async () => ({ kind: 'conflict' }),
      readAttempt: async () => ({
        answers: [
          {
            questionKey: 'q1',
            answer: { choice: 'server' } as const,
            isFlagged: false,
            version: 7,
          },
        ],
        status: 'in_progress',
      }),
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }));
    await settle();
    expect(f.events.onConflictToast).toHaveBeenCalledWith('q1');
    expect(queue.hasPending()).toBe(false);
    expect(queue.hasLocalWork('q1')).toBe(false);
  });

  it('never sends expectedVersion 0 and uses null for a new row', async () => {
    const calls: SaveRequest[] = [];
    const f = fake({
      saveOne: async (_key, request) => {
        calls.push(request);
        return { kind: 'saved', version: 1 };
      },
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }));
    await settle();
    expect(calls[0]?.expectedVersion).toBeNull();
    queue.setAnswer('q1', body({ choice: 'b' }));
    await settle();
    expect(calls[1]?.expectedVersion).toBe(1);
    expect(calls.every((call) => call.expectedVersion !== 0)).toBe(true);
  });

  it('keeps pending while offline, then flushes a batch of at most 20 unique keys', async () => {
    const batches: Array<Array<{ questionKey: string } & SaveRequest>> = [];
    const f = fake({
      saveBatch: async (items) => {
        batches.push(items);
        return {
          kind: 'ok',
          results: items.map((item) => ({
            questionKey: item.questionKey,
            status: 'saved' as const,
            answer: item.answer,
            isFlagged: item.isFlagged,
            version: 1,
          })),
          remainingSeconds: 70,
        };
      },
    });
    const queue = createExamSaveQueue(f);
    f.online.value = false;
    for (let index = 0; index < 23; index += 1) {
      queue.setAnswer(`q${String(index + 1)}`, body({ choice: 'a' }));
    }
    expect(batches).toHaveLength(0);
    expect(queue.pendingCount()).toBe(23);

    f.online.value = true;
    await settle();
    await queue.flush({ force: true });
    await settle();
    // The queue drains 23 pending answers as two batches of at most 20.
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(20);
    expect(batches[1]).toHaveLength(3);
    expect(new Set(batches[0]?.map((item) => item.questionKey)).size).toBe(20);
    expect(f.events.onRemainingSeconds).toHaveBeenCalledWith(70);
  });

  it('sends an unknown batch body with its old key before the newest value', async () => {
    const batches: Array<Array<{ questionKey: string } & SaveRequest>> = [];
    const single: SaveRequest[] = [];
    let first = true;
    const f = fake({
      saveOne: async (_key, request) => {
        single.push(request);
        if (first) {
          first = false;
          return { kind: 'network' };
        }
        return { kind: 'saved', version: 2 };
      },
      saveBatch: async (items) => {
        batches.push(items);
        return {
          kind: 'ok',
          results: items.map((item) => ({
            questionKey: item.questionKey,
            status: 'saved' as const,
            answer: item.answer,
            isFlagged: item.isFlagged,
            version: 1,
          })),
        };
      },
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }));
    await settle();
    expect(single[0]?.idempotencyKey).toBe('uuid-1');
    // The backoff timer releases the blocked question, then the reconnect
    // flush sends its unknown body in a batch with the new pending answer.
    queue.setAnswer('q2', body({ choice: 'b' }), { debounceMs: 600 });
    await settle();
    // Clearing the backoff and flushing now sends q1's unknown body first,
    // in the same batch as q2's newest value.
    await queue.retryNow();
    await settle();
    const batchItem = batches[0]?.find((item) => item.questionKey === 'q1');
    expect(batchItem).toMatchObject({
      answer: { choice: 'a' },
      idempotencyKey: 'uuid-1',
      expectedVersion: null,
    });
  });

  it('debounces fill_blank and flushes on demand', async () => {
    const calls: SaveRequest[] = [];
    const f = fake({
      saveOne: async (_key, request) => {
        calls.push(request);
        return { kind: 'saved', version: 1 };
      },
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q3', body({ text: '你' }), { debounceMs: 600 });
    queue.setAnswer('q3', body({ text: '你好' }), { debounceMs: 600 });
    expect(calls).toHaveLength(0);
    expect(f.timers.some((timer) => timer.ms === 600)).toBe(true);
    await f.runTimers();
    await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.answer).toEqual({ text: '你好' });
  });

  it('applies version from replayed rows and removes pending', async () => {
    const f = fake({
      saveOne: async () => ({ kind: 'replayed', version: 9 }),
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }));
    await settle();
    expect(queue.questionVersion('q1')).toBe(9);
    expect(queue.hasPending()).toBe(false);
  });

  it('seeds the version of an existing answer so the first edit does not conflict (F1)', async () => {
    const calls: SaveRequest[] = [];
    const f = fake({
      saveOne: async (_key, request) => {
        calls.push(request);
        return { kind: 'saved', version: 4 };
      },
    });
    const queue = createExamSaveQueue({
      ...f,
      initialRows: [
        {
          questionKey: 'q1',
          answer: { choice: 'a' },
          isFlagged: false,
          version: 3,
        },
      ],
    });
    expect(f.events.onServerAnswer).not.toHaveBeenCalled();
    queue.setAnswer('q1', body({ choice: 'b' }));
    await settle();
    expect(calls[0]?.expectedVersion).toBe(3);
  });

  it('retries a failed batch with every item, its old key and body (F3)', async () => {
    const batches: Array<Array<{ questionKey: string } & SaveRequest>> = [];
    let attempt = 0;
    const f = fake({
      saveBatch: async (items) => {
        batches.push(items);
        attempt += 1;
        if (attempt === 1) return { kind: 'network' };
        return {
          kind: 'ok',
          results: items.map((item) => ({
            questionKey: item.questionKey,
            status: 'saved' as const,
            answer: item.answer,
            isFlagged: item.isFlagged,
            version: 2,
          })),
        };
      },
    });
    const queue = createExamSaveQueue(f);
    for (const key of ['q1', 'q2', 'q3']) {
      queue.setAnswer(key, body({ choice: 'a' }), { debounceMs: 600 });
    }
    await queue.flush({ force: true });
    await settle();
    expect(batches).toHaveLength(1);
    const firstKeys = new Map(
      batches[0]?.map((item) => [item.questionKey, item.idempotencyKey]),
    );
    expect(firstKeys.size).toBe(3);
    expect(f.events.onOffline).toHaveBeenLastCalledWith(true);

    await queue.retryNow();
    await settle();
    expect(batches).toHaveLength(2);
    const retry = batches[1] ?? [];
    expect(retry.map((item) => item.questionKey).sort()).toEqual([
      'q1',
      'q2',
      'q3',
    ]);
    for (const item of retry) {
      expect(item.idempotencyKey).toBe(firstKeys.get(item.questionKey));
      expect(item.answer).toEqual({ choice: 'a' });
    }
  });

  it('halts on a terminal response: one transport call, queue drained (F5)', async () => {
    const saveOne = vi.fn(async () => ({ kind: 'expired' }) as SaveResponse);
    const f = fake({ saveOne });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }));
    queue.setAnswer('q2', body({ choice: 'b' }));
    await settle();
    expect(saveOne).toHaveBeenCalledTimes(1);
    expect(queue.hasPending()).toBe(false);
    expect(f.events.onLocked).toHaveBeenCalledTimes(1);
  });

  it('A1: a rejected old body does not drop an edit typed while in flight', async () => {
    const calls: SaveRequest[] = [];
    let attempt = 0;
    const f = fake({
      saveOne: async (_key, request) => {
        calls.push(request);
        attempt += 1;
        if (attempt === 1) return { kind: 'network' };
        if (attempt === 2)
          return { kind: 'invalid', code: 'EXAM_ANSWER_INVALID' };
        return { kind: 'saved', version: 2 };
      },
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }));
    await settle();
    queue.setAnswer('q1', body({ choice: 'b' }));
    await settle();
    await queue.retryNow();
    await settle();
    const choiceOf = (call: SaveRequest): string | null =>
      call.answer !== null && 'choice' in call.answer
        ? call.answer.choice
        : null;
    expect(calls.some((call) => choiceOf(call) === 'a')).toBe(true);
    const newValue = calls.find((call) => choiceOf(call) === 'b');
    expect(newValue).toBeDefined();
    expect(newValue?.idempotencyKey).not.toBe(calls[0]?.idempotencyKey);
  });

  it('A2: a second KEY_REUSED fails only that question', async () => {
    const f = fake({
      saveOne: async () => ({
        kind: 'invalid',
        code: 'EXAM_IDEMPOTENCY_KEY_REUSED',
      }),
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }));
    queue.setAnswer('q2', body({ choice: 'b' }), { debounceMs: 600 });
    await settle();
    expect(f.events.onInvalid).toHaveBeenCalledWith(
      'q1',
      'EXAM_IDEMPOTENCY_KEY_REUSED',
    );
    expect(f.events.onLocked).not.toHaveBeenCalled();
  });

  it('A3: a batch 400 retries every item as single PUTs', async () => {
    const singles: SaveRequest[] = [];
    const f = fake({
      saveBatch: async () => ({ kind: 'invalid', code: 'EXAM_ANSWER_INVALID' }),
      saveOne: async (_key, request) => {
        singles.push(request);
        return { kind: 'saved', version: 2 };
      },
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }), { debounceMs: 600 });
    queue.setAnswer('q2', body({ choice: 'b' }), { debounceMs: 600 });
    await queue.flush({ force: true });
    await settle();
    expect(singles.map((item) => item.answer)).toEqual([
      { choice: 'a' },
      { choice: 'b' },
    ]);
  });

  it('A4: halt reports unsent keys before clearing them', async () => {
    const f = fake({ saveOne: async () => ({ kind: 'expired' }) });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }));
    queue.setAnswer('q2', body({ choice: 'b' }), { debounceMs: 600 });
    await settle();
    expect(f.events.onLocked).toHaveBeenCalledWith(
      'expired',
      expect.arrayContaining(['q2']),
    );
    expect(queue.hasPending()).toBe(false);
  });

  it('A5: failures never clear the offline banner', async () => {
    let attempt = 0;
    const f = fake({
      saveOne: async () => {
        attempt += 1;
        return attempt === 1 ? { kind: 'network' } : { kind: 'unavailable' };
      },
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }));
    await settle();
    await queue.retryNow();
    await settle();
    const last = vi.mocked(f.events.onOffline).mock.calls.at(-1);
    expect(last?.[0]).toBe(true);
  });

  it('A6: a batch saved item without version is replayed with its old key', async () => {
    const batches: Array<Array<{ questionKey: string } & SaveRequest>> = [];
    const singles: SaveRequest[] = [];
    const readAttempt = vi.fn(async () => ({
      answers: [],
      status: 'in_progress',
    }));
    const f = fake({
      saveBatch: async (items) => {
        batches.push(items);
        return {
          kind: 'ok',
          results: items.map((item) =>
            item.questionKey === 'q1'
              ? { questionKey: 'q1', status: 'saved' as const }
              : {
                  questionKey: item.questionKey,
                  status: 'saved' as const,
                  version: 5,
                },
          ),
        };
      },
      saveOne: async (_key, request) => {
        singles.push(request);
        return { kind: 'replayed', version: 4 };
      },
      readAttempt,
    });
    const queue = createExamSaveQueue(f);
    f.online.value = false;
    queue.setAnswer('q1', body({ choice: 'a' }));
    queue.setAnswer('q2', body({ choice: 'b' }));
    await settle();
    f.online.value = true;
    await queue.flush({ force: true });
    await settle();
    expect(batches).toHaveLength(1);
    const sentQ1 = batches[0]?.find((item) => item.questionKey === 'q1');
    // No invented version and no refresh: the exact body stays unknown.
    expect(readAttempt).not.toHaveBeenCalled();
    expect(queue.questionVersion('q1')).toBeNull();
    expect(queue.hasPending()).toBe(true);
    await f.runTimers();
    await settle();
    expect(singles).toHaveLength(1);
    expect(singles[0]?.idempotencyKey).toBe(sentQ1?.idempotencyKey);
    expect(singles[0]?.answer).toEqual({ choice: 'a' });
    expect(queue.questionVersion('q1')).toBe(4);
    expect(queue.hasPending()).toBe(false);
  });

  it('E1: a mid-batch edit survives per-item invalid', async () => {
    let resolveBatch: ((value: BatchResponse) => void) | undefined;
    const singles: SaveRequest[] = [];
    const f = fake({
      saveBatch: () =>
        new Promise<BatchResponse>((resolve) => {
          resolveBatch = resolve;
        }),
      saveOne: async (_key, request) => {
        singles.push(request);
        return { kind: 'saved', version: 5 };
      },
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }), { debounceMs: 600 });
    queue.setAnswer('q2', body({ choice: 'b' }), { debounceMs: 600 });
    const pending = queue.flush({ force: true });
    await settle();
    // While the batch is in flight the learner edits q1 again.
    queue.setAnswer('q1', body({ choice: 'z' }));
    await settle();
    resolveBatch?.({
      kind: 'ok',
      results: [
        { questionKey: 'q1', status: 'invalid', code: 'EXAM_ANSWER_INVALID' },
        { questionKey: 'q2', status: 'saved', version: 4 },
      ],
    });
    await pending;
    await settle();
    const choiceOf = (call: SaveRequest): string | null =>
      call.answer !== null && 'choice' in call.answer
        ? call.answer.choice
        : null;
    expect(singles.some((call) => choiceOf(call) === 'z')).toBe(true);
  });

  it('E1: a mid-batch edit survives per-item not_found', async () => {
    let resolveBatch: ((value: BatchResponse) => void) | undefined;
    const singles: SaveRequest[] = [];
    const f = fake({
      saveBatch: () =>
        new Promise<BatchResponse>((resolve) => {
          resolveBatch = resolve;
        }),
      saveOne: async (_key, request) => {
        singles.push(request);
        return { kind: 'saved', version: 5 };
      },
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }), { debounceMs: 600 });
    queue.setAnswer('q2', body({ choice: 'b' }), { debounceMs: 600 });
    const pending = queue.flush({ force: true });
    await settle();
    queue.setAnswer('q1', body({ choice: 'z' }));
    await settle();
    resolveBatch?.({
      kind: 'ok',
      results: [
        { questionKey: 'q1', status: 'not_found' },
        { questionKey: 'q2', status: 'saved', version: 4 },
      ],
    });
    await pending;
    await settle();
    expect(f.events.onInvalid).toHaveBeenCalledWith(
      'q1',
      'EXAM_QUESTION_NOT_FOUND',
    );
    const choiceOf = (call: SaveRequest): string | null =>
      call.answer !== null && 'choice' in call.answer
        ? call.answer.choice
        : null;
    const sent = singles.find((call) => choiceOf(call) === 'z');
    expect(sent).toBeDefined();
  });

  it('task2: a mid-batch conflict keeps the newer edit and sends it with the current version', async () => {
    let resolveBatch: ((value: BatchResponse) => void) | undefined;
    const singles: SaveRequest[] = [];
    const f = fake({
      saveBatch: () =>
        new Promise<BatchResponse>((resolve) => {
          resolveBatch = resolve;
        }),
      saveOne: async (_key, request) => {
        singles.push(request);
        return { kind: 'saved', version: 6 };
      },
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }), { debounceMs: 600 });
    queue.setAnswer('q2', body({ choice: 'b' }), { debounceMs: 600 });
    const pending = queue.flush({ force: true });
    await settle();
    queue.setAnswer('q1', body({ choice: 'z' }));
    await settle();
    resolveBatch?.({
      kind: 'ok',
      results: [
        {
          questionKey: 'q1',
          status: 'conflict',
          current: {
            answer: { choice: 'server' },
            isFlagged: false,
            version: 5,
          },
        },
        { questionKey: 'q2', status: 'saved', version: 4 },
      ],
    });
    await pending;
    await settle();
    expect(f.events.onConflictToast).not.toHaveBeenCalled();
    const choiceOf = (call: SaveRequest): string | null =>
      call.answer !== null && 'choice' in call.answer
        ? call.answer.choice
        : null;
    expect(singles.some((call) => choiceOf(call) === 'z')).toBe(true);
    const sent = singles.find((call) => choiceOf(call) === 'z');
    expect(sent?.expectedVersion).toBe(5);
  });

  it('task2: a batch conflict without current refreshes the version and keeps the newer edit', async () => {
    let resolveBatch: ((value: BatchResponse) => void) | undefined;
    const singles: SaveRequest[] = [];
    const readAttempt = vi.fn(async () => ({
      answers: [
        {
          questionKey: 'q1',
          answer: { choice: 'server' } as const,
          isFlagged: false,
          version: 6,
        },
      ],
      status: 'in_progress',
    }));
    const f = fake({
      saveBatch: () =>
        new Promise<BatchResponse>((resolve) => {
          resolveBatch = resolve;
        }),
      saveOne: async (_key, request) => {
        singles.push(request);
        return { kind: 'saved', version: 6 };
      },
      readAttempt,
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }), { debounceMs: 600 });
    queue.setAnswer('q2', body({ choice: 'b' }), { debounceMs: 600 });
    const pending = queue.flush({ force: true });
    await settle();
    queue.setAnswer('q1', body({ choice: 'z' }));
    await settle();
    resolveBatch?.({
      kind: 'ok',
      results: [
        { questionKey: 'q1', status: 'conflict', current: null },
        { questionKey: 'q2', status: 'saved', version: 4 },
      ],
    });
    await pending;
    await settle();
    expect(readAttempt).toHaveBeenCalled();
    expect(f.events.onConflictToast).not.toHaveBeenCalled();
    const choiceOf = (call: SaveRequest): string | null =>
      call.answer !== null && 'choice' in call.answer
        ? call.answer.choice
        : null;
    const sent = singles.find((call) => choiceOf(call) === 'z');
    expect(sent).toBeDefined();
    expect(sent?.expectedVersion).toBe(6);
  });

  it('task2: a batch conflict without current and no newer edit toasts and drops pending', async () => {
    let resolveBatch: ((value: BatchResponse) => void) | undefined;
    const f = fake({
      saveBatch: () =>
        new Promise<BatchResponse>((resolve) => {
          resolveBatch = resolve;
        }),
      saveOne: async () => ({ kind: 'saved', version: 6 }),
      readAttempt: async () => ({
        answers: [
          {
            questionKey: 'q1',
            answer: { choice: 'server' } as const,
            isFlagged: false,
            version: 6,
          },
        ],
        status: 'in_progress',
      }),
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }), { debounceMs: 600 });
    queue.setAnswer('q2', body({ choice: 'b' }), { debounceMs: 600 });
    const pending = queue.flush({ force: true });
    await settle();
    resolveBatch?.({
      kind: 'ok',
      results: [
        { questionKey: 'q1', status: 'conflict', current: null },
        { questionKey: 'q2', status: 'saved', version: 4 },
      ],
    });
    await pending;
    await settle();
    expect(f.events.onConflictToast).toHaveBeenCalledWith('q1');
    expect(queue.hasPending()).toBe(false);
    expect(queue.questionVersion('q1')).toBe(6);
  });

  it('G2: a batch item with no result is retried with its old key after backoff', async () => {
    const batches: Array<Array<{ questionKey: string } & SaveRequest>> = [];
    const singles: SaveRequest[] = [];
    let transportCalls = 0;
    const f = fake({
      saveBatch: async (items) => {
        transportCalls += 1;
        batches.push(items);
        const first = items.find((item) => item.questionKey === 'q1');
        return {
          kind: 'ok',
          results: [
            {
              questionKey: 'q1',
              status: 'saved' as const,
              answer: first?.answer ?? null,
              isFlagged: first?.isFlagged ?? false,
              version: 3,
            },
          ],
        };
      },
      saveOne: async (_key, request) => {
        transportCalls += 1;
        singles.push(request);
        return { kind: 'saved', version: 4 };
      },
    });
    const queue = createExamSaveQueue(f);
    // Queue both answers while offline so the test drives exactly the reconnect
    // batch and, later, exactly the backoff timer (no debounce timers pending).
    f.online.value = false;
    queue.setAnswer('q1', body({ choice: 'a' }));
    queue.setAnswer('q2', body({ choice: 'b' }));
    await settle();
    expect(batches).toHaveLength(0);
    f.online.value = true;
    await queue.flush({ force: true });
    await settle();
    expect(batches).toHaveLength(1);
    expect(transportCalls).toBe(1);
    expect(singles).toHaveLength(0);
    expect(queue.hasPending()).toBe(true);
    const sentQ2 = batches[0]?.find((item) => item.questionKey === 'q2');
    // Item q2 got no result: only the backoff timer may resend it.
    await f.runTimers();
    await settle();
    expect(singles).toHaveLength(1);
    expect(singles[0]).toMatchObject({
      answer: { choice: 'b' },
      idempotencyKey: sentQ2?.idempotencyKey,
    });
    expect(transportCalls).toBe(2);
  });

  it('task1: a forced flush resends a blocked question immediately with its old key', async () => {
    const calls: SaveRequest[] = [];
    const f = fake({
      saveOne: async (_key, request) => {
        calls.push(request);
        return calls.length === 1
          ? { kind: 'unavailable' }
          : { kind: 'saved', version: 2 };
      },
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q3', body({ text: 'x' }));
    await settle();
    expect(calls).toHaveLength(1);
    // q3 is blocked behind its 1 s backoff; the forced flush must ignore it.
    expect(f.timers).toHaveLength(1);
    await queue.flush({ force: true });
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.idempotencyKey).toBe(calls[0]?.idempotencyKey);
    expect(queue.hasPending()).toBe(false);
    expect(f.timers).toHaveLength(0);
  });

  it('task1: dispose stops timers and events from a response that lands later', async () => {
    let resolveSave: ((value: SaveResponse) => void) | undefined;
    const calls: SaveRequest[] = [];
    const f = fake({
      saveOne: (_key, request) => {
        calls.push(request);
        return new Promise<SaveResponse>((resolve) => {
          resolveSave = resolve;
        });
      },
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }));
    await settle();
    expect(calls).toHaveLength(1);
    queue.dispose();
    const eventsAfterDispose = {
      onSaved: vi.mocked(f.events.onSaved).mock.calls.length,
      onSaving: vi.mocked(f.events.onSaving).mock.calls.length,
      onAuthLost: vi.mocked(f.events.onAuthLost).mock.calls.length,
      onLocked: vi.mocked(f.events.onLocked).mock.calls.length,
    };
    resolveSave?.({ kind: 'unavailable' });
    await settle();
    // No backoff timer may be created after dispose, so 60 s later (no timer
    // left to fire) the transport is still called exactly once.
    expect(f.timers).toHaveLength(0);
    await f.runTimers();
    expect(calls).toHaveLength(1);
    expect(vi.mocked(f.events.onSaved).mock.calls.length).toBe(
      eventsAfterDispose.onSaved,
    );
    expect(vi.mocked(f.events.onSaving).mock.calls.length).toBe(
      eventsAfterDispose.onSaving,
    );
    expect(vi.mocked(f.events.onAuthLost).mock.calls.length).toBe(
      eventsAfterDispose.onAuthLost,
    );
    expect(vi.mocked(f.events.onLocked).mock.calls.length).toBe(
      eventsAfterDispose.onLocked,
    );
  });

  it('task1: dispose stops the refresh of a conflict that lands later', async () => {
    let resolveSave: ((value: SaveResponse) => void) | undefined;
    const readAttempt = vi.fn(async () => ({
      answers: [],
      status: 'in_progress' as const,
    }));
    const f = fake({
      saveOne: () =>
        new Promise<SaveResponse>((resolve) => {
          resolveSave = resolve;
        }),
      readAttempt,
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }));
    await settle();
    queue.dispose();
    resolveSave?.({ kind: 'conflict' });
    await settle();
    expect(readAttempt).not.toHaveBeenCalled();
  });

  it('task1: dispose stops the auth-lost event of an in-flight response', async () => {
    let resolveSave: ((value: SaveResponse) => void) | undefined;
    const f = fake({
      saveOne: () =>
        new Promise<SaveResponse>((resolve) => {
          resolveSave = resolve;
        }),
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }));
    await settle();
    queue.dispose();
    resolveSave?.({ kind: 'unauthorized' });
    await settle();
    expect(f.events.onAuthLost).not.toHaveBeenCalled();
    expect(f.events.onLocked).not.toHaveBeenCalled();
  });

  it('task2: an unknown 2xx replays the sent body before the newest edit', async () => {
    const calls: SaveRequest[] = [];
    const f = fake({
      saveOne: async (_key, request) => {
        calls.push(request);
        if (calls.length === 1) return { kind: 'network' };
        if (calls.length === 2) return { kind: 'replayed', version: 2 };
        return { kind: 'saved', version: 3 };
      },
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }));
    await settle();
    queue.setAnswer('q1', body({ choice: 'b' }));
    await settle();
    expect(queue.hasPending()).toBe(true);
    await f.runTimers();
    await settle();
    expect(calls).toHaveLength(3);
    expect(calls[1]?.answer).toEqual({ choice: 'a' });
    expect(calls[1]?.idempotencyKey).toBe(calls[0]?.idempotencyKey);
    expect(calls[2]?.answer).toEqual({ choice: 'b' });
    expect(calls[2]?.expectedVersion).toBe(2);
    expect(f.events.onConflictToast).not.toHaveBeenCalled();
  });

  it('task2: a saved batch resets the retry attempt so the next backoff is 1 s', async () => {
    let singleAttempts = 0;
    const f = fake({
      saveOne: async () => {
        singleAttempts += 1;
        return { kind: 'unavailable' };
      },
      saveBatch: async (items) => ({
        kind: 'ok',
        results: items.map((item) => ({
          questionKey: item.questionKey,
          status: 'saved' as const,
          version: 5,
        })),
      }),
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }));
    await settle();
    expect(singleAttempts).toBe(1);
    // With q1 blocked (retryAttempt = 1), queue q2 while offline, then let
    // q1's backoff timer fire: the retry becomes a successful batch for both.
    f.online.value = false;
    queue.setAnswer('q2', body({ choice: 'b' }));
    await settle();
    expect(queue.hasPending()).toBe(true);
    f.online.value = true;
    await f.runTimers();
    await settle();
    expect(queue.hasPending()).toBe(false);
    expect(f.timers).toHaveLength(0);
    queue.setAnswer('q1', body({ choice: 'c' }));
    await settle();
    expect(singleAttempts).toBe(2);
    expect(f.timers.at(-1)?.ms).toBe(1_000);
  });

  it('G3: a normal flush skips a fill that is still inside its debounce', async () => {
    const singles: SaveRequest[] = [];
    const f = fake({
      saveOne: async (_key, request) => {
        singles.push(request);
        return { kind: 'saved', version: 1 };
      },
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ text: 'x' }), { debounceMs: 600 });
    await queue.flush();
    await settle();
    expect(singles).toHaveLength(0);
    queue.setAnswer('q2', body({ choice: 'a' }));
    await queue.flush();
    await settle();
    expect(singles.map((call) => call.answer)).toEqual([{ choice: 'a' }]);
    await f.runTimers();
    await settle();
    expect(singles.map((call) => call.answer)).toEqual([
      { choice: 'a' },
      { text: 'x' },
    ]);
  });

  it('G3: a forced flush sends the debounced fill and keeps hasLocalWork honest', async () => {
    const singles: SaveRequest[] = [];
    const f = fake({
      saveOne: async (_key, request) => {
        singles.push(request);
        return { kind: 'saved', version: 1 };
      },
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ text: 'y' }), { debounceMs: 600 });
    expect(queue.hasLocalWork('q1')).toBe(true);
    expect(queue.hasPending()).toBe(true);
    await queue.flush();
    await settle();
    expect(singles).toHaveLength(0);
    expect(queue.hasLocalWork('q1')).toBe(true);
    await queue.flush({ force: true });
    await settle();
    expect(singles).toHaveLength(1);
    expect(singles[0]?.answer).toEqual({ text: 'y' });
    expect(queue.hasPending()).toBe(false);
    expect(queue.hasLocalWork('q1')).toBe(false);
  });

  it('A7: two conflicts are read sequentially and each row is applied', async () => {
    const batches: Array<Array<{ questionKey: string } & SaveRequest>> = [];
    let reads = 0;
    const readAttempt = vi.fn(async () => {
      reads += 1;
      const questionKey = reads === 1 ? 'q1' : 'q2';
      return {
        answers: [
          {
            questionKey,
            answer: { choice: 'server' } as const,
            isFlagged: false,
            version: 6 + reads,
          },
        ],
        status: 'in_progress' as const,
      };
    });
    const f = fake({
      saveBatch: async (items) => {
        batches.push(items);
        return {
          kind: 'ok',
          results: items.map((item) => ({
            questionKey: item.questionKey,
            status: 'conflict' as const,
            current: null,
          })),
        };
      },
      readAttempt,
    });
    const queue = createExamSaveQueue(f);
    f.online.value = false;
    queue.setAnswer('q1', body({ choice: 'a' }));
    queue.setAnswer('q2', body({ choice: 'b' }));
    await settle();
    f.online.value = true;
    await queue.flush();
    await settle();
    expect(batches).toHaveLength(1);
    expect(readAttempt).toHaveBeenCalledTimes(2);
    expect(queue.questionVersion('q1')).toBe(7);
    expect(queue.questionVersion('q2')).toBe(8);
    expect(queue.hasPending()).toBe(false);
  });

  it('A7: a read without the conflict row is not treated as a refresh', async () => {
    let reads = 0;
    const readAttempt = vi.fn(async () => {
      reads += 1;
      return {
        answers:
          reads === 1
            ? [
                {
                  questionKey: 'q1',
                  answer: { choice: 'server' } as const,
                  isFlagged: false,
                  version: 7,
                },
              ]
            : [],
        status: 'in_progress' as const,
      };
    });
    const f = fake({
      saveBatch: async (items) => ({
        kind: 'ok',
        results: items.map((item) => ({
          questionKey: item.questionKey,
          status: 'conflict' as const,
          current: null,
        })),
      }),
      readAttempt,
    });
    const queue = createExamSaveQueue(f);
    f.online.value = false;
    queue.setAnswer('q1', body({ choice: 'a' }));
    queue.setAnswer('q2', body({ choice: 'b' }));
    await settle();
    f.online.value = true;
    await queue.flush();
    await settle();
    expect(readAttempt).toHaveBeenCalledTimes(2);
    expect(queue.questionVersion('q1')).toBe(7);
    // q2's read returned no row: its pending must survive and no toast fires.
    expect(queue.questionVersion('q2')).toBeNull();
    expect(f.events.onConflictToast).toHaveBeenCalledTimes(1);
    expect(f.events.onConflictToast).toHaveBeenCalledWith('q1');
    expect(queue.hasPending()).toBe(true);
  });

  it('F7a: a failed refresh keeps pending, backs off and shows no toast', async () => {
    const f = fake({
      saveOne: async () => ({ kind: 'conflict' }),
      readAttempt: async () => {
        throw new Error('GET failed');
      },
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }));
    await settle();
    expect(f.events.onConflictToast).not.toHaveBeenCalled();
    expect(queue.hasPending()).toBe(true);
    expect(f.timers.at(-1)?.ms).toBe(1_000);
  });

  it('F7b: a refresh applies only the conflict row, never a question with local work', async () => {
    let resolveSave: ((value: SaveResponse) => void) | undefined;
    const calls: SaveRequest[] = [];
    const f = fake({
      saveOne: (_key, request) => {
        calls.push(request);
        if (calls.length === 1) {
          return new Promise<SaveResponse>((resolve) => {
            resolveSave = resolve;
          });
        }
        return new Promise<SaveResponse>(() => undefined);
      },
      readAttempt: async () => ({
        answers: [
          {
            questionKey: 'q1',
            answer: { choice: 'server' } as const,
            isFlagged: false,
            version: 7,
          },
          {
            questionKey: 'q2',
            answer: { choice: 'server' } as const,
            isFlagged: false,
            version: 9,
          },
        ],
        status: 'in_progress',
      }),
    });
    const queue = createExamSaveQueue(f);
    queue.setAnswer('q1', body({ choice: 'a' }));
    await settle();
    queue.setAnswer('q2', body({ choice: 'b' }));
    await settle();
    resolveSave?.({ kind: 'conflict' });
    await settle();
    const keys = vi
      .mocked(f.events.onServerAnswer)
      .mock.calls.map((call) => call[0]);
    expect(keys).toContain('q1');
    expect(keys).not.toContain('q2');
  });
});
