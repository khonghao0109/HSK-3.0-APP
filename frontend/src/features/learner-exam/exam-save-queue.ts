import type { ExamAnswer } from './exam-take-model';

/**
 * TL-136: in-memory autosave queue. One request in flight per question,
 * latest-wins, an idempotency key that survives retries of the same body and
 * changes with the body, batch flush for reconnect, and the documented error
 * policy. Transport and timers are injected so every branch is unit-testable.
 */

export type ExamAnswerBody = {
  answer: ExamAnswer;
  isFlagged: boolean;
};

export type SaveRequest = ExamAnswerBody & {
  expectedVersion: number | null;
  idempotencyKey: string;
};

export type SaveResponse =
  | {
      kind: 'saved' | 'replayed';
      version: number;
      answer?: ExamAnswer;
      isFlagged?: boolean;
      remainingSeconds?: number;
    }
  | { kind: 'conflict' }
  | { kind: 'invalid'; code: string }
  | { kind: 'expired' }
  | { kind: 'closed' }
  | { kind: 'unauthorized' }
  | { kind: 'not_found' }
  | { kind: 'rate_limited' }
  | { kind: 'unavailable' }
  | { kind: 'network' };

export type BatchResult = {
  questionKey: string;
  status: 'saved' | 'replayed' | 'conflict' | 'invalid' | 'not_found';
  version?: number;
  answer?: ExamAnswer;
  isFlagged?: boolean;
  code?: string;
  current?: { answer: ExamAnswer; isFlagged: boolean; version: number } | null;
};

export type BatchFailure =
  | { kind: 'expired' }
  | { kind: 'closed' }
  | { kind: 'unauthorized' }
  | { kind: 'not_found' }
  | { kind: 'rate_limited' }
  | { kind: 'unavailable' }
  | { kind: 'network' }
  | { kind: 'invalid'; code: string };

export type BatchResponse =
  | {
      kind: 'ok';
      results: BatchResult[];
      remainingSeconds?: number;
    }
  | BatchFailure;

export type AttemptRows = {
  answers: Array<{
    questionKey: string;
    answer: ExamAnswer;
    isFlagged: boolean;
    version: number;
  }>;
  status: string;
  remainingSeconds?: number;
  /**
   * Existing questions, so a fresh-server row for a question the client never
   * touched can still be applied.
   */
};

export type ExamQueueTransport = {
  saveOne: (questionKey: string, body: SaveRequest) => Promise<SaveResponse>;
  saveBatch: (
    items: Array<{ questionKey: string } & SaveRequest>,
  ) => Promise<BatchResponse>;
  readAttempt: () => Promise<AttemptRows>;
};

export type ExamQueueEvents = {
  onSaving: (state: { saving: boolean; pending: number }) => void;
  onSaved: (questionKey: string) => void;
  onServerAnswer: (
    questionKey: string,
    answer: ExamAnswer,
    isFlagged: boolean,
    version: number,
  ) => void;
  onConflictToast: (questionKey: string) => void;
  onInvalid: (questionKey: string, code: string) => void;
  onLocked: (status: 'expired' | 'closed', unsavedKeys?: string[]) => void;
  onAuthLost: () => void;
  onNotFound: () => void;
  onRemainingSeconds: (seconds: number) => void;
  onOffline: (offline: boolean) => void;
};

export type ExamQueueDeps = {
  randomUUID: () => string;
  setTimeout: (handler: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  isOnline: () => boolean;
  now: () => number;
};

const FILL_BLANK_DEBOUNCE_MS = 600;
const MAX_BATCH_ITEMS = 20;
const MAX_BACKOFF_MS = 30_000;

type PendingBody = {
  answer: ExamAnswer;
  isFlagged: boolean;
  idempotencyKey: string;
};

type QuestionState = {
  questionKey: string;
  version: number | null;
  serverAnswer: ExamAnswer;
  serverFlagged: boolean;
  /** Newest value not yet acknowledged by the server. */
  pending: PendingBody | null;
  /** Unknown-outcome body that must be retried/replayed verbatim. */
  unknown: PendingBody | null;
  inflight: boolean;
  failed: boolean;
  keyReuseRetried: boolean;
  debounce: unknown | null;
  backoff: unknown | null;
  retryAttempt: number;
};

export type ExamSaveQueue = {
  setAnswer: (
    questionKey: string,
    body: ExamAnswerBody,
    options?: { debounceMs?: number },
  ) => void;
  flush: (options?: { force?: boolean }) => Promise<void>;
  retryNow: () => Promise<void>;
  hasPending: () => boolean;
  pendingCount: () => number;
  /** F9: true while this question has unsent/unknown/in-flight/debounced work. */
  hasLocalWork: (questionKey: string) => boolean;
  questionVersion: (questionKey: string) => number | null;
  dispose: () => void;
};

export type InitialRow = {
  questionKey: string;
  answer: ExamAnswer;
  isFlagged: boolean;
  version: number;
};

export function createExamSaveQueue(input: {
  transport: ExamQueueTransport;
  events: ExamQueueEvents;
  deps: ExamQueueDeps;
  /** TL-136/F1: answers loaded with the attempt seed `version`/server value. */
  initialRows?: InitialRow[];
}): ExamSaveQueue {
  const { transport, deps } = input;
  const listeners = input.events;
  const states = new Map<string, QuestionState>();
  /** Questions whose last attempt failed and wait for their backoff timer. */
  const blocked = new Set<string>();
  let reading: Promise<void> | null = null;
  let flushing: Promise<void> | null = null;
  let halted = false;
  let disposed = false;

  /**
   * M4.2b: after `dispose()` the queue must go silent for the island. The
   * in-flight request still finishes, but no event may reach React and no timer
   * may be scheduled.
   */
  const events: ExamQueueEvents = {
    onSaving: (state) => {
      if (!disposed) listeners.onSaving(state);
    },
    onSaved: (questionKey) => {
      if (!disposed) listeners.onSaved(questionKey);
    },
    onServerAnswer: (questionKey, answer, isFlagged, version) => {
      if (!disposed)
        listeners.onServerAnswer(questionKey, answer, isFlagged, version);
    },
    onConflictToast: (questionKey) => {
      if (!disposed) listeners.onConflictToast(questionKey);
    },
    onInvalid: (questionKey, code) => {
      if (!disposed) listeners.onInvalid(questionKey, code);
    },
    onLocked: (status, unsavedKeys) => {
      if (!disposed) listeners.onLocked(status, unsavedKeys);
    },
    onAuthLost: () => {
      if (!disposed) listeners.onAuthLost();
    },
    onNotFound: () => {
      if (!disposed) listeners.onNotFound();
    },
    onRemainingSeconds: (seconds) => {
      if (!disposed) listeners.onRemainingSeconds(seconds);
    },
    onOffline: (offline) => {
      if (!disposed) listeners.onOffline(offline);
    },
  };

  const stateFor = (questionKey: string): QuestionState => {
    let state = states.get(questionKey);
    if (state === undefined) {
      state = {
        questionKey,
        version: null,
        serverAnswer: null,
        serverFlagged: false,
        pending: null,
        unknown: null,
        inflight: false,
        failed: false,
        keyReuseRetried: false,
        debounce: null,
        backoff: null,
        retryAttempt: 0,
      };
      states.set(questionKey, state);
    }
    return state;
  };

  for (const row of input.initialRows ?? []) {
    const seeded = stateFor(row.questionKey);
    seeded.version = row.version;
    seeded.serverAnswer = row.answer;
    seeded.serverFlagged = row.isFlagged;
  }

  const pendingList = (): QuestionState[] =>
    halted
      ? []
      : [...states.values()].filter(
          (state) =>
            state.pending !== null ||
            (state.unknown !== null && !state.inflight),
        );

  const emitPending = (): void => {
    events.onSaving({
      saving: [...states.values()].some((state) => state.inflight),
      pending: pendingList().length,
    });
  };

  const clearTimer = (
    handle: unknown,
    which: 'debounce' | 'backoff',
    state: QuestionState,
  ): void => {
    if (handle === null) return;
    deps.clearTimeout(handle);
    state[which] = null;
  };

  const scheduleBackoff = (state: QuestionState): void => {
    if (disposed) return;
    if (state.backoff !== null) return;
    const delay = Math.min(1_000 * 2 ** state.retryAttempt, MAX_BACKOFF_MS);
    state.retryAttempt += 1;
    blocked.add(state.questionKey);
    state.backoff = deps.setTimeout(() => {
      state.backoff = null;
      blocked.delete(state.questionKey);
      void flush();
    }, delay);
  };

  const applyRow = (
    questionKey: string,
    answer: ExamAnswer,
    isFlagged: boolean,
    version: number,
  ): void => {
    const state = stateFor(questionKey);
    state.version = version;
    state.serverAnswer = answer;
    state.serverFlagged = isFlagged;
    events.onServerAnswer(questionKey, answer, isFlagged, version);
  };

  /** F5: a terminal answer stops all transport and clears the queue. */
  const halt = (
    status: 'expired' | 'closed' | 'unauthorized' | 'not_found',
  ): void => {
    if (halted) return;
    // A4: report the unsent keys *before* clearing them, so the locked banner
    // can still say "Có câu chưa lưu được trước khi hết giờ.".
    const unsaved = [...states.values()]
      .filter((state) => state.pending !== null || state.unknown !== null)
      .map((state) => state.questionKey);
    halted = true;
    for (const state of states.values()) {
      state.pending = null;
      state.unknown = null;
      clearTimer(state.debounce, 'debounce', state);
      clearTimer(state.backoff, 'backoff', state);
    }
    emitPending();
    if (status === 'expired' || status === 'closed') {
      events.onLocked(status, unsaved);
    } else if (status === 'unauthorized') events.onAuthLost();
    else events.onNotFound();
  };

  const sendOne = async (state: QuestionState): Promise<void> => {
    if (halted || disposed) return;
    // F4: an unknown-outcome body must be replayed verbatim before the newest
    // edit, otherwise the retry would look like a different request.
    const body = state.unknown ?? state.pending;
    if (body === null || state.inflight) return;
    state.inflight = true;
    state.failed = false;
    emitPending();
    let response: SaveResponse;
    try {
      response = await transport.saveOne(state.questionKey, {
        answer: body.answer,
        isFlagged: body.isFlagged,
        expectedVersion: state.version,
        idempotencyKey: body.idempotencyKey,
      });
    } catch {
      response = { kind: 'network' };
    } finally {
      state.inflight = false;
    }
    await applySingleResponse(state, body, response);
    emitPending();
  };

  const applySingleResponse = async (
    state: QuestionState,
    body: PendingBody,
    response: SaveResponse,
  ): Promise<void> => {
    switch (response.kind) {
      case 'saved':
      case 'replayed': {
        state.retryAttempt = 0;
        if (response.remainingSeconds !== undefined) {
          events.onRemainingSeconds(response.remainingSeconds);
        }
        const answer = response.answer ?? body.answer;
        const isFlagged = response.isFlagged ?? body.isFlagged;
        if (response.version === undefined) {
          // F2: never invent a version; the server is the only source.
          await refreshFromServer(state.questionKey);
        } else {
          applyRow(state.questionKey, answer, isFlagged, response.version);
        }
        if (state.pending?.idempotencyKey === body.idempotencyKey) {
          state.pending = null;
        }
        state.unknown = null;
        events.onOffline(false);
        events.onSaved(state.questionKey);
        if (state.pending !== null) await sendOne(state);
        return;
      }
      case 'conflict': {
        await resolveConflict(state.questionKey, body.idempotencyKey);
        return;
      }
      case 'invalid': {
        state.failed = true;
        if (response.code === 'EXAM_IDEMPOTENCY_KEY_REUSED') {
          if (state.keyReuseRetried) {
            // A2: a second reuse fails this question only; the rest of the
            // queue keeps going (no halt).
            events.onInvalid(state.questionKey, response.code);
            state.pending = null;
            state.unknown = null;
            emitPending();
            return;
          }
          state.keyReuseRetried = true;
          if (state.pending !== null) {
            state.pending = {
              ...state.pending,
              idempotencyKey: deps.randomUUID(),
            };
          }
          state.unknown = null;
          emitPending();
          await sendOne(state);
          return;
        }
        events.onInvalid(state.questionKey, response.code);
        state.unknown = null;
        // A1: only drop the newest edit when it is the body that failed; an
        // edit typed while the request was in flight must still be sent.
        if (state.pending?.idempotencyKey === body.idempotencyKey) {
          state.pending = null;
        }
        if (state.pending !== null) await sendOne(state);
        return;
      }
      case 'rate_limited':
      case 'unavailable':
      case 'network': {
        // Keep the body verbatim for the next retry; the newest edit (if any)
        // stays in `pending` and is sent after the unknown body is settled.
        state.unknown = body;
        if (!deps.isOnline() || response.kind === 'network') {
          events.onOffline(true);
        }
        scheduleBackoff(state);
        emitPending();
        return;
      }
      default: {
        halt(
          response.kind === 'unauthorized'
            ? 'unauthorized'
            : response.kind === 'not_found'
              ? 'not_found'
              : response.kind === 'expired'
                ? 'expired'
                : 'closed',
        );
      }
    }
  };

  /**
   * D13: the authoritative row of a settled conflict must reach the island
   * again once the question has no local work; the `onServerAnswer` fired
   * during the refresh was ignored because the rejected body was still pending.
   */
  const emitSettledRow = (state: QuestionState): void => {
    if (state.version === null) return;
    events.onServerAnswer(
      state.questionKey,
      state.serverAnswer,
      state.serverFlagged,
      state.version,
    );
  };

  const hasLocalWork = (questionKey: string): boolean => {
    const state = states.get(questionKey);
    if (state === undefined) return false;
    return (
      state.pending !== null ||
      state.unknown !== null ||
      state.inflight ||
      state.debounce !== null
    );
  };

  /**
   * F7: refresh only the conflict question plus rows the learner is not
   * editing. Returns false when the GET failed (caller keeps pending/backoff).
   */
  const refreshFromServer = async (
    conflictKey: string | null = null,
  ): Promise<boolean> => {
    if (disposed) return false;
    if (reading !== null) {
      // A second caller waits for the in-flight read, then opens its own read
      // so the caller's key is definitely applied (A7).
      await reading;
    }
    let ok = true;
    reading = (async () => {
      try {
        const attempt = await transport.readAttempt();
        if (attempt.remainingSeconds !== undefined) {
          events.onRemainingSeconds(attempt.remainingSeconds);
        }
        let conflictRowApplied = conflictKey === null;
        for (const row of attempt.answers) {
          if (
            row.questionKey !== conflictKey &&
            hasLocalWork(row.questionKey)
          ) {
            continue;
          }
          applyRow(row.questionKey, row.answer, row.isFlagged, row.version);
          if (row.questionKey === conflictKey) conflictRowApplied = true;
        }
        // A7: reporting a successful refresh for a row we never applied would
        // let the caller drop `pending` (and toast) against a stale version.
        if (!conflictRowApplied) ok = false;
        if (attempt.status !== 'in_progress') {
          halt(attempt.status === 'timed_out' ? 'expired' : 'closed');
        }
      } catch {
        ok = false;
        events.onOffline(true);
      } finally {
        reading = null;
      }
    })();
    await reading;
    return ok;
  };

  const resolveConflict = async (
    questionKey: string,
    sentIdempotencyKey: string,
  ): Promise<void> => {
    const state = stateFor(questionKey);
    const refreshed = await refreshFromServer(questionKey);
    if (!refreshed) {
      // Keep the pending edit; the normal backoff retries it.
      scheduleBackoff(state);
      emitPending();
      return;
    }
    // The rejected body is settled either way: never replay it again.
    state.unknown = null;
    if (state.pending?.idempotencyKey === sentIdempotencyKey) {
      state.pending = null;
      clearTimer(state.debounce, 'debounce', state);
      emitSettledRow(state);
      events.onConflictToast(questionKey);
      return;
    }
    if (state.pending !== null) {
      // A newer edit was typed while the rejected body was in flight: keep it
      // with a fresh key and let the next flush round send it with the
      // refreshed version. No toast: the learner's latest edit is not lost.
      state.pending = { ...state.pending, idempotencyKey: deps.randomUUID() };
    }
  };

  const flush = async (options?: { force?: boolean }): Promise<void> => {
    if (halted || disposed) return;
    const force = options?.force === true;
    if (force) {
      // M4.2b: a last flush must not skip a question just because it is waiting
      // for its backoff timer or its fill debounce; cancel those timers and
      // send now. Clearing the debounce also keeps `hasLocalWork` honest once
      // the body has been sent.
      for (const state of states.values()) {
        state.retryAttempt = 0;
        clearTimer(state.backoff, 'backoff', state);
        clearTimer(state.debounce, 'debounce', state);
      }
      blocked.clear();
    }
    if (flushing !== null) {
      if (!force) return flushing;
      await flushing;
      if (halted || disposed) return;
    }
    flushing = (async () => {
      if (!deps.isOnline()) {
        events.onOffline(true);
        emitPending();
        return;
      }
      // One flush drains the queue: a response can enqueue the newest value
      // (latest-wins) or a fresh key (reused-key retry), and callers await the
      // whole drain.
      for (let round = 0; round < 100; round += 1) {
        if (halted || disposed) break;
        if (!deps.isOnline()) break;
        const pending = pendingList().filter(
          (state) =>
            !state.inflight &&
            !blocked.has(state.questionKey) &&
            // G3: a regular flush lets an in-progress fill_blank debounce win;
            // only a final (forced) flush sends the half-typed answer.
            (force || state.debounce === null) &&
            (state.pending !== null || state.unknown !== null),
        );
        if (pending.length === 0) break;
        if (pending.length >= 2) {
          await flushBatch(pending);
        } else {
          const state = pending[0];
          if (state === undefined) break;
          if (state.pending === null && state.unknown !== null) {
            state.pending = state.unknown;
          }
          await sendOne(state);
        }
      }
    })().finally(() => {
      flushing = null;
    });
    return flushing;
  };

  const flushBatch = async (pending: QuestionState[]): Promise<void> => {
    if (halted || disposed) return;
    const chunk = pending.slice(0, MAX_BATCH_ITEMS);
    const items = chunk.map((state) => {
      const body =
        state.unknown !== null && state.pending !== null
          ? // The unknown body goes first, verbatim; the newest value follows
            // after the server acknowledges it (TL-136).
            state.unknown
          : (state.pending ?? state.unknown);
      if (body === null) throw new Error('flush without body');
      return {
        questionKey: state.questionKey,
        answer: body.answer,
        isFlagged: body.isFlagged,
        expectedVersion: state.version,
        idempotencyKey: body.idempotencyKey,
      };
    });
    const sentBody = new Map(
      items.map((item) => [
        item.questionKey,
        {
          answer: item.answer,
          isFlagged: item.isFlagged,
          idempotencyKey: item.idempotencyKey,
        },
      ]),
    );
    for (const state of chunk) state.inflight = true;
    emitPending();
    let response: BatchResponse;
    try {
      response = await transport.saveBatch(items);
    } catch {
      response = { kind: 'network' };
    } finally {
      for (const state of chunk) state.inflight = false;
    }
    if (response.kind !== 'ok') {
      for (const state of chunk) {
        const sent = sentBody.get(state.questionKey);
        if (sent !== undefined) state.unknown = sent;
      }
      if (response.kind === 'invalid') {
        // A3: a batch 400 says nothing about individual items; keep every
        // pending body and retry each one with a single PUT.
        for (const state of chunk) {
          const sent = sentBody.get(state.questionKey);
          if (sent !== undefined) state.unknown = sent;
        }
        for (const state of chunk) await sendOne(state);
        emitPending();
        return;
      }
      if (
        response.kind === 'expired' ||
        response.kind === 'closed' ||
        response.kind === 'unauthorized' ||
        response.kind === 'not_found'
      ) {
        halt(response.kind);
        return;
      }
      events.onOffline(true);
      // F3: block the whole chunk, so the same flush does not resend it and the
      // retry carries every item with its original key and body.
      for (const state of chunk) scheduleBackoff(state);
      emitPending();
      return;
    }
    if (response.remainingSeconds !== undefined) {
      events.onRemainingSeconds(response.remainingSeconds);
    }
    for (const result of response.results) {
      const state = stateFor(result.questionKey);
      state.unknown = null;
      if (result.status === 'saved' || result.status === 'replayed') {
        state.retryAttempt = 0;
        const answer =
          result.answer ?? sentBody.get(result.questionKey)?.answer ?? null;
        const isFlagged =
          result.isFlagged ??
          sentBody.get(result.questionKey)?.isFlagged ??
          false;
        if (result.version === undefined) {
          // M4.2b: an unreadable 2xx item is an unknown outcome. Keep the sent
          // body for a verbatim replay (the server will answer `replayed` with
          // the real version); never drop pending or invent a version.
          const sent = sentBody.get(result.questionKey);
          if (sent !== undefined) state.unknown = sent;
          scheduleBackoff(state);
          continue;
        }
        applyRow(result.questionKey, answer, isFlagged, result.version);
        if (
          state.pending?.idempotencyKey ===
          sentBody.get(result.questionKey)?.idempotencyKey
        ) {
          state.pending = null;
        } else if (state.pending !== null) {
          // The newest value was not the one sent: send it now with a new key.
          state.pending = {
            ...state.pending,
            idempotencyKey: deps.randomUUID(),
          };
        }
        events.onSaved(result.questionKey);
      } else if (result.status === 'conflict') {
        const sentItem = sentBody.get(result.questionKey);
        const isLatest =
          state.pending?.idempotencyKey === sentItem?.idempotencyKey;
        if (result.current !== undefined && result.current !== null) {
          applyRow(
            result.questionKey,
            result.current.answer,
            result.current.isFlagged,
            result.current.version,
          );
          if (isLatest) {
            state.pending = null;
            clearTimer(state.debounce, 'debounce', state);
            emitSettledRow(state);
            events.onConflictToast(result.questionKey);
          } else if (state.pending !== null) {
            state.pending = {
              ...state.pending,
              idempotencyKey: deps.randomUUID(),
            };
          }
        } else {
          const refreshed = await refreshFromServer(result.questionKey);
          if (!refreshed) {
            scheduleBackoff(state);
            continue;
          }
          if (isLatest) {
            state.pending = null;
            clearTimer(state.debounce, 'debounce', state);
            emitSettledRow(state);
            events.onConflictToast(result.questionKey);
          } else if (state.pending !== null) {
            state.pending = {
              ...state.pending,
              idempotencyKey: deps.randomUUID(),
            };
          }
        }
      } else if (result.status === 'invalid') {
        const code = result.code ?? 'EXAM_ANSWER_INVALID';
        state.unknown = null;
        if (code === 'EXAM_IDEMPOTENCY_KEY_REUSED' && !state.keyReuseRetried) {
          state.keyReuseRetried = true;
          if (state.pending !== null) {
            state.pending = {
              ...state.pending,
              idempotencyKey: deps.randomUUID(),
            };
          }
        } else {
          events.onInvalid(result.questionKey, code);
          state.unknown = null;
          if (
            state.pending?.idempotencyKey ===
            sentBody.get(result.questionKey)?.idempotencyKey
          ) {
            state.pending = null;
          } else if (state.pending !== null) {
            state.pending = {
              ...state.pending,
              idempotencyKey: deps.randomUUID(),
            };
          }
        }
      } else {
        events.onInvalid(result.questionKey, 'EXAM_QUESTION_NOT_FOUND');
        state.unknown = null;
        if (
          state.pending?.idempotencyKey ===
          sentBody.get(result.questionKey)?.idempotencyKey
        ) {
          state.pending = null;
        }
      }
    }
    // G2: a chunk item with no result keeps its sent body for a later retry
    // and must not be resent inside this flush.
    const resultKeys = new Set(
      response.results.map((item) => item.questionKey),
    );
    for (const state of chunk) {
      if (resultKeys.has(state.questionKey)) continue;
      const sent = sentBody.get(state.questionKey);
      if (sent !== undefined) state.unknown = sent;
      scheduleBackoff(state);
    }
    events.onOffline(false);
    emitPending();
  };

  return {
    setAnswer(questionKey, body, options) {
      if (disposed) return;
      const state = stateFor(questionKey);
      clearTimer(state.debounce, 'debounce', state);
      state.pending = {
        answer: body.answer,
        isFlagged: body.isFlagged,
        idempotencyKey: deps.randomUUID(),
      };
      state.keyReuseRetried = false;
      state.failed = false;
      const debounceMs = options?.debounceMs ?? 0;
      emitPending();
      if (debounceMs > 0) {
        state.debounce = deps.setTimeout(() => {
          state.debounce = null;
          void flush();
        }, debounceMs);
        return;
      }
      void flush();
    },
    flush,
    async retryNow() {
      // A user-driven retry is a final flush: it clears every backoff, ignores
      // the fill debounce and sends the pending bodies now.
      await flush({ force: true });
    },
    hasPending: () => pendingList().length > 0,
    pendingCount: () => pendingList().length,
    hasLocalWork,
    questionVersion: (questionKey) => states.get(questionKey)?.version ?? null,
    dispose() {
      disposed = true;
      for (const state of states.values()) {
        clearTimer(state.debounce, 'debounce', state);
        clearTimer(state.backoff, 'backoff', state);
      }
      blocked.clear();
    },
  };
}

export const EXAM_QUEUE_DEBOUNCE_MS = FILL_BLANK_DEBOUNCE_MS;
export const EXAM_QUEUE_MAX_BATCH = MAX_BATCH_ITEMS;
