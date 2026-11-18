import type {
  AttemptRows,
  BatchFailure,
  BatchResult,
  ExamQueueTransport,
  SaveRequest,
  SaveResponse,
} from './exam-save-queue';
import type { ExamAnswer } from './exam-take-model';

/**
 * F2: the BFF transport of the autosave queue, plain TypeScript (no Zod) so it
 * can be unit-tested with a fake `fetch`. The backend answers a batch item with
 * a nested `ExamAnswerView`; version, answer and flag live inside that view.
 */

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** M4.2b: an autosave must not hang forever on a dead connection. */
export const EXAM_SAVE_TIMEOUT_MS = 15_000;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function errorCode(payload: unknown): string | null {
  const error = record(record(payload)?.error);
  const code = error?.code;
  return typeof code === 'string' ? code : null;
}

function viewOf(value: unknown): {
  questionKey: string;
  answer: ExamAnswer;
  isFlagged: boolean;
  version: number;
} | null {
  const view = record(value);
  if (view === null) return null;
  const questionKey = view.questionKey;
  const version = view.version;
  if (typeof questionKey !== 'string' || typeof version !== 'number') {
    return null;
  }
  return {
    questionKey,
    answer: (view.answer as ExamAnswer) ?? null,
    isFlagged: Boolean(view.isFlagged),
    version,
  };
}

function batchFailure(status: number, code: string | null): BatchFailure {
  if (code === 'EXAM_ATTEMPT_EXPIRED') return { kind: 'expired' };
  if (code === 'EXAM_ATTEMPT_CLOSED') return { kind: 'closed' };
  if (status === 401 || status === 403) return { kind: 'unauthorized' };
  if (status === 404) return { kind: 'not_found' };
  if (status === 429) return { kind: 'rate_limited' };
  if (status >= 500) return { kind: 'unavailable' };
  return { kind: 'invalid', code: code ?? 'EXAM_ANSWER_INVALID' };
}

function terminal(status: number, code: string | null): SaveResponse {
  if (code === 'EXAM_ATTEMPT_EXPIRED') return { kind: 'expired' };
  if (code === 'EXAM_ATTEMPT_CLOSED') return { kind: 'closed' };
  if (status === 401 || status === 403) return { kind: 'unauthorized' };
  if (status === 404) return { kind: 'not_found' };
  if (status === 429) return { kind: 'rate_limited' };
  if (status >= 500) return { kind: 'unavailable' };
  return { kind: 'invalid', code: code ?? 'EXAM_ANSWER_INVALID' };
}

export function createExamTransport(
  attemptId: number,
  fetcher: Fetcher = fetch,
  timeoutMs: number = EXAM_SAVE_TIMEOUT_MS,
): ExamQueueTransport {
  const url = (suffix: string) =>
    `/api/learner/exam/attempts/${String(attemptId)}${suffix}`;

  return {
    async saveOne(questionKey: string, body: SaveRequest) {
      let response: Response;
      try {
        response = await fetcher(url(`/answers/${questionKey}`), {
          method: 'PUT',
          keepalive: true,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return { kind: 'network' };
      }
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const code = errorCode(payload);
        if (
          response.status === 409 &&
          code === 'EXAM_ANSWER_VERSION_CONFLICT'
        ) {
          return { kind: 'conflict' };
        }
        return terminal(response.status, code);
      }
      const data = record(record(payload)?.data);
      const view = viewOf(data);
      if (view === null) {
        // M4.2b: a 2xx we cannot read is an *unknown* outcome, not a validation
        // failure. Replay the same body/key later; the server then answers
        // `replayed` with the real version.
        return { kind: 'network' };
      }
      const remaining = data?.['remainingSeconds'];
      return {
        kind: 'saved',
        version: view.version,
        answer: view.answer,
        isFlagged: view.isFlagged,
        ...(typeof remaining === 'number'
          ? { remainingSeconds: remaining }
          : {}),
      };
    },

    async saveBatch(items: Array<{ questionKey: string } & SaveRequest>) {
      let response: Response;
      try {
        response = await fetcher(url('/answers'), {
          method: 'PUT',
          keepalive: true,
          headers: { 'content-type': 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({
            items: items.map((item) => ({
              questionKey: item.questionKey,
              answer: item.answer,
              isFlagged: item.isFlagged,
              expectedVersion: item.expectedVersion,
              idempotencyKey: item.idempotencyKey,
            })),
          }),
        });
      } catch {
        return { kind: 'network' };
      }
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        return batchFailure(response.status, errorCode(payload));
      }
      const data = record(record(payload)?.data);
      const rawResults = data?.results;
      if (!Array.isArray(rawResults)) return { kind: 'unavailable' };
      const results: BatchResult[] = rawResults.flatMap(
        (raw): BatchResult[] => {
          const item = record(raw);
          if (item === null || typeof item.questionKey !== 'string') return [];
          const status = item.status;
          if (
            status !== 'saved' &&
            status !== 'replayed' &&
            status !== 'conflict' &&
            status !== 'invalid' &&
            status !== 'not_found'
          ) {
            return [];
          }
          const answerView = viewOf(item.answer);
          const currentView = viewOf(item.current);
          return [
            {
              questionKey: item.questionKey,
              status: status as BatchResult['status'],
              ...(answerView === null
                ? {}
                : {
                    version: answerView.version,
                    answer: answerView.answer,
                    isFlagged: answerView.isFlagged,
                  }),
              ...(typeof item.code === 'string' ? { code: item.code } : {}),
              ...(item.current === undefined
                ? {}
                : {
                    current:
                      currentView === null
                        ? null
                        : {
                            answer: currentView.answer,
                            isFlagged: currentView.isFlagged,
                            version: currentView.version,
                          },
                  }),
            },
          ];
        },
      );
      const remaining = data?.['remainingSeconds'];
      return {
        kind: 'ok',
        results,
        ...(typeof remaining === 'number'
          ? { remainingSeconds: remaining }
          : {}),
      };
    },

    async readAttempt(): Promise<AttemptRows> {
      const response = await fetcher(url(''));
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error('attempt read failed');
      const data = record(record(payload)?.data);
      if (data === null) throw new Error('attempt read failed');
      const answers = Array.isArray(data.answers) ? data.answers : [];
      return {
        answers: answers.flatMap((raw) => {
          const view = viewOf(raw);
          return view === null
            ? []
            : [
                {
                  questionKey: view.questionKey,
                  answer: view.answer,
                  isFlagged: view.isFlagged,
                  version: view.version,
                },
              ];
        }),
        status: typeof data.status === 'string' ? data.status : 'in_progress',
        ...(typeof data['remainingSeconds'] === 'number'
          ? { remainingSeconds: data['remainingSeconds'] as number }
          : {}),
      };
    },
  };
}
