import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import { pageActionFor } from '@/features/learner-exam/exam-409-matrix';
import { getExamAttempt } from '@/features/learner-exam/exam-attempt-service';
import { parseAttemptId } from '@/features/learner-exam/exam-ids';
import { getExamReview } from '@/features/learner-exam/exam-review-service';
import { ExamReviewView } from '@/features/learner-exam/exam-review-view';
import {
  parseReviewFilter,
  reviewFilterHref,
} from '@/features/learner-exam/exam-review-model';
import { BackendRequestError, isAuthFailure } from '@/lib/api/api-error';

import './exam-review.css';

export const metadata: Metadata = {
  title: 'Xem lại bài thi',
};

function ReviewShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="ex exr exv">
      <header className="exr-bar w-only">
        <Link
          className="icon-btn"
          href="/learn/exam"
          aria-label="Quay lại danh sách đề"
        >
          <svg className="icon" aria-hidden="true">
            <use href="#i-arrow-left" />
          </svg>
        </Link>
        <h1 className="exr-bar__title">Xem lại bài thi</h1>
        <span aria-hidden="true" className="exr-bar__spacer" />
      </header>
      <header className="exr-mbar m-only">
        <Link
          className="icon-btn"
          href="/learn/exam"
          aria-label="Quay lại danh sách đề"
        >
          <svg className="icon" aria-hidden="true">
            <use href="#i-arrow-left" />
          </svg>
        </Link>
        <h1 className="exr-mbar__title">Xem lại bài thi</h1>
        <span aria-hidden="true" className="exr-mbar__spacer" />
      </header>
      <div className="exr-body exv-body">{children}</div>
    </main>
  );
}

/** Q171/TL-188: an invalidated attempt has no review, only the intro. */
function ClosedReview({ introHref }: { introHref: string }) {
  return (
    <ReviewShell>
      <section className="exv-notice" aria-labelledby="review-closed-title">
        <h2 className="exv-notice__title" id="review-closed-title">
          Không xem lại được bài thi
        </h2>
        <p className="exv-notice__text">
          Bài thi đã bị huỷ nên không có nội dung xem lại.
        </p>
        <Link className="btn btn--outline exv-notice__cta" href={introHref}>
          Về màn giới thiệu đề
        </Link>
      </section>
    </ReviewShell>
  );
}

/** Retryable failure (409 EXAM_RESULT_UNAVAILABLE or an unknown 409). */
function UnavailableReview({ retryHref }: { retryHref: string }) {
  return (
    <ReviewShell>
      <section className="exv-notice" role="alert">
        <h2 className="exv-notice__title">Chưa tải được bài xem lại</h2>
        <p className="exv-notice__text">Vui lòng thử lại sau ít phút.</p>
        <a className="btn btn--primary exv-notice__cta" href={retryHref}>
          Thử lại
        </a>
      </section>
    </ReviewShell>
  );
}

/** TL-187: the shared attempt-id parser replaces the lesson parser here. */
export default async function LearnerExamReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ attemptId: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const attemptId = parseAttemptId((await params).attemptId);
  if (attemptId === null) notFound();
  const filter = parseReviewFilter((await searchParams).filter);

  const session = await getServerLearnerSession();
  if (session.state !== 'learner' || !session.token) redirect('/sign-in');

  let review;
  try {
    review = await getExamReview(attemptId, session.token);
  } catch (error: unknown) {
    if (isAuthFailure(error)) redirect('/sign-in');
    if (
      error instanceof BackendRequestError &&
      (error.status === 400 || error.status === 404)
    ) {
      notFound();
    }
    if (error instanceof BackendRequestError && error.status === 409) {
      const action = pageActionFor('review', error.code);
      if (action === 'take') {
        redirect(`/learn/exam/attempts/${String(attemptId)}`);
      }
      if (action === 'closed') {
        let introHref = '/learn/exam';
        try {
          const attempt = await getExamAttempt(attemptId, session.token);
          introHref = `/learn/exam/${String(attempt.testId)}`;
        } catch {
          // The intro link is a convenience; the list is the safe fallback.
        }
        return <ClosedReview introHref={introHref} />;
      }
      return (
        <UnavailableReview retryHref={reviewFilterHref(attemptId, filter)} />
      );
    }
    throw error;
  }

  return <ExamReviewView review={review} filter={filter} />;
}
