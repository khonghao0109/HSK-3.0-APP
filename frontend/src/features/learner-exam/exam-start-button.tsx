'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { useLearnerToast } from '@/features/learner-shell/learner-toast';

export const EXAM_START_UNAVAILABLE =
  'Đề thi tạm thời không làm được. Vui lòng thử lại sau.';
export const EXAM_START_RATE_LIMITED =
  'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.';
export const EXAM_START_FAILED = 'Chưa bắt đầu được bài thi. Vui lòng thử lại.';

function conflictCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/**
 * TL-119(b): with no exam-taking screen yet (M4.2b), a successful start only
 * refreshes the server component, which then shows the in-progress card.
 *
 * The idempotency key lives in a ref: a network failure keeps it so the retry
 * replays the same request, while every definitive HTTP answer (2xx/4xx)
 * starts a new window (the backend would otherwise replay a finished attempt).
 */
export function ExamStartButton({ testId }: { testId: number }) {
  const router = useRouter();
  const showToast = useLearnerToast();
  const idempotencyKey = useRef<string | null>(null);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);

  const start = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    if (idempotencyKey.current === null) {
      idempotencyKey.current = crypto.randomUUID();
    }

    let response: Response;
    try {
      response = await fetch(`/api/learner/exam/tests/${testId}/attempts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: idempotencyKey.current }),
      });
    } catch {
      // Unreachable server: the request may or may not have been processed, so
      // the key stays and the next click is a safe replay.
      inFlight.current = false;
      setPending(false);
      showToast(EXAM_START_FAILED, 'alert');
      return;
    }

    idempotencyKey.current = null;
    inFlight.current = false;
    setPending(false);

    if (response.ok) {
      // TL-140/Q126: a successful start goes straight to the attempt page; an
      // unexpected payload falls back to the intro refresh.
      const body: unknown = await response.json().catch(() => null);
      const data =
        typeof body === 'object' && body !== null
          ? (body as { data?: unknown }).data
          : null;
      const id =
        typeof data === 'object' && data !== null
          ? (data as { id?: unknown }).id
          : null;
      if (typeof id === 'number' && Number.isInteger(id) && id > 0) {
        router.push(`/learn/exam/attempts/${String(id)}`);
      } else {
        router.refresh();
      }
      return;
    }
    if (response.status === 401) {
      router.replace('/sign-in');
      return;
    }
    // The page then renders not-found for a vanished test.
    if (response.status === 404) {
      router.refresh();
      return;
    }
    if (response.status === 429) {
      showToast(EXAM_START_RATE_LIMITED, 'alert');
      return;
    }
    if (response.status === 409) {
      const body: unknown = await response.json().catch(() => null);
      if (conflictCode(body) === 'EXAM_TEST_UNAVAILABLE') {
        showToast(EXAM_START_UNAVAILABLE, 'alert');
        return;
      }
    }
    showToast(EXAM_START_FAILED, 'alert');
  };

  return (
    <button
      type="button"
      className="btn btn--primary btn--lg exi-cta"
      onClick={() => {
        void start();
      }}
      disabled={pending}
      aria-busy={pending}
    >
      <span>Bắt đầu thi</span>
      <svg className="icon" aria-hidden="true">
        <use href="#i-play" />
      </svg>
    </button>
  );
}
