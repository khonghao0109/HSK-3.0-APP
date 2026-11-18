/**
 * TL-188: the single matrix of exam 409 codes → behaviour, per route. BFF
 * handlers forward a code only when the browser can act on it; server pages
 * map the same codes to a redirect, a closed notice or a retry block. Keeping
 * one module stops the answer/submit/grant/result/review routes from drifting
 * apart when a new conflict code is added.
 */
export type Exam409Route = 'answer' | 'submit' | 'grant' | 'result' | 'review';

/** Page-level reactions (only the result and review server pages have them). */
export type Exam409PageAction = 'take' | 'closed' | 'retry';

export type Exam409Code =
  | 'EXAM_ANSWER_VERSION_CONFLICT'
  | 'EXAM_ATTEMPT_EXPIRED'
  | 'EXAM_ATTEMPT_CLOSED'
  | 'EXAM_IDEMPOTENCY_KEY_REUSED'
  | 'EXAM_ATTEMPT_ALREADY_SUBMITTED'
  | 'EXAM_RESULT_UNAVAILABLE'
  | 'EXAM_ATTEMPT_NOT_TERMINAL';

type Exam409Behaviour = {
  /** Routes whose BFF forwards this code to the browser. */
  forward: readonly Exam409Route[];
  /** Server-page action for the result/review routes; absent = retry block. */
  page: Partial<Record<'result' | 'review', Exam409PageAction>>;
};

export const EXAM_409_BEHAVIOUR: Record<Exam409Code, Exam409Behaviour> = {
  EXAM_ANSWER_VERSION_CONFLICT: { forward: ['answer'], page: {} },
  EXAM_ATTEMPT_EXPIRED: {
    forward: ['answer', 'submit', 'grant'],
    page: {},
  },
  // Q157: result/review serve an invalidated attempt with the closed notice.
  EXAM_ATTEMPT_CLOSED: {
    forward: ['answer', 'submit', 'grant', 'result'],
    page: { result: 'closed', review: 'closed' },
  },
  EXAM_IDEMPOTENCY_KEY_REUSED: { forward: ['answer', 'submit'], page: {} },
  EXAM_ATTEMPT_ALREADY_SUBMITTED: { forward: ['submit'], page: {} },
  EXAM_RESULT_UNAVAILABLE: {
    forward: ['result'],
    page: { result: 'retry', review: 'retry' },
  },
  EXAM_ATTEMPT_NOT_TERMINAL: {
    forward: ['result'],
    page: { result: 'take', review: 'take' },
  },
};

/** Codes the BFF route for `route` may forward (an empty set = never). */
export function conflictCodesFor(route: Exam409Route): Set<string> {
  const codes = new Set<string>();
  for (const [code, behaviour] of Object.entries(EXAM_409_BEHAVIOUR) as Array<
    [Exam409Code, Exam409Behaviour]
  >) {
    if (behaviour.forward.includes(route)) codes.add(code);
  }
  return codes;
}

/**
 * Page action for a 409 `code`. `null` means "unknown code on this route": the
 * caller must fall back to the retry block, never to a success render.
 */
export function pageActionFor(
  route: 'result' | 'review',
  code: string | null | undefined,
): Exam409PageAction | null {
  if (code === null || code === undefined) return null;
  const behaviour = (
    EXAM_409_BEHAVIOUR as Record<string, Exam409Behaviour | undefined>
  )[code];
  return behaviour?.page[route] ?? null;
}
