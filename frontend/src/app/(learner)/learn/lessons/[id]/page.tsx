import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { LearnerBackButton } from '@/features/learner-auth/learner-back-button';
import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import {
  percentClass,
  wholePercent,
} from '@/features/learner-home/learning-home-contract';
import { levelLabel } from '@/features/learner-home/level-label';
import type { LessonActivity } from '@/features/learner-lesson/lesson-activity-contract';
import { getLessonActivity } from '@/features/learner-lesson/lesson-activity-service';
import {
  LESSON_ROW_IMAGES,
  lessonRows,
  parseLessonId,
} from '@/features/learner-lesson/lesson-sections';
import { ToastButton } from '@/features/learner-shell/learner-toast';
import {
  TOAST_COMING_SOON,
  TOAST_LOCKED,
} from '@/features/learner-shell/learner-toast-messages';
import {
  getCurrentGoal,
  getOnboardingStatus,
} from '@/features/onboarding/onboarding-service';
import { routeForOnboarding } from '@/features/onboarding/route-for-onboarding';
import { BackendRequestError, isAuthFailure } from '@/lib/api/api-error';

export const metadata: Metadata = {
  title: 'Bài học',
};

function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      aria-hidden="true"
    >
      <use href={`#i-${name}`} />
    </svg>
  );
}

/**
 * Lesson page (M2.5a, Q32–Q44). Every `notFound()` and `redirect()` runs
 * before anything renders: the segment has no `loading.tsx` or Suspense, so
 * the response keeps its real 404 / 307 status.
 */
export default async function LearnerLessonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const lessonId = parseLessonId((await params).id);
  if (lessonId === null) notFound();

  const session = await getServerLearnerSession();
  if (session.state !== 'learner' || !session.token) {
    redirect('/sign-in');
  }

  let activity: LessonActivity | null = null;
  let redirectTarget: string | null = null;
  let authFailed = false;
  let missing = false;
  try {
    const status = await getOnboardingStatus(session.token);
    if (status.nextStep !== 'ready') {
      const goal =
        status.nextStep === 'generate_plan'
          ? await getCurrentGoal(session.token)
          : null;
      redirectTarget = routeForOnboarding(status, goal) ?? '/onboarding/goal';
    } else {
      activity = await getLessonActivity(session.token, lessonId);
    }
  } catch (error) {
    if (isAuthFailure(error)) authFailed = true;
    else if (error instanceof BackendRequestError && error.status === 404)
      missing = true;
    else throw error;
  }

  if (authFailed) redirect('/sign-in');
  if (redirectTarget) redirect(redirectTarget);
  if (missing || !activity) notFound();

  const { lesson, level, position, sections } = activity;
  const locked = activity.state === 'locked';
  const percent = wholePercent(activity.progress.completionPercent);
  const description = lesson.description?.trim() || null;
  const rowMessage = locked ? TOAST_LOCKED : TOAST_COMING_SOON;

  return (
    <>
      <header className="m02-head m02-bar">
        <LearnerBackButton
          fallbackHref="/learn/path"
          ariaLabel="Quay lại lộ trình"
        />
        <p className="m02-bar__title">{lesson.title}</p>
        <ToastButton
          className="icon-btn lesson-fav"
          aria-label="Yêu thích bài học"
          message={TOAST_COMING_SOON}
        >
          <Icon name="heart" />
        </ToastButton>
      </header>

      <main className="m02-sheet lesson">
        <section className="lesson-hero" aria-labelledby="lesson-title">
          <span className="lesson-hero__img" aria-hidden="true">
            <Icon name="book-open" />
          </span>
          <div className="lesson-hero__info">
            <h1 className="lesson-hero__title" id="lesson-title">
              {lesson.title}
            </h1>
            <p className="lesson-hero__badge">
              {`${levelLabel(level.code)} `}
              <span aria-hidden="true">•</span>
              <span className="sr-only">,</span>
              {` Bài ${position}`}
            </p>
            {description && <p className="lesson-hero__desc">{description}</p>}
            <div
              className="progress lesson-hero__bar"
              role="progressbar"
              aria-label="Tiến độ bài học"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <span className={percentClass(percent)} />
            </div>
            <p className="lesson-hero__pct">
              <b>{percent}%</b> hoàn thành
            </p>
          </div>
        </section>

        <h2 className="lesson-section">Nội dung bài học</h2>
        <ul className="lesson-rows">
          {lessonRows(sections, locked).map((row) => {
            const image = LESSON_ROW_IMAGES[row.kind];
            const className = [
              'lrow',
              image.tone,
              row.done ? 'is-done' : '',
              row.locked ? 'is-locked' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <li key={row.kind}>
                <ToastButton
                  className={className}
                  aria-disabled={row.locked ? 'true' : undefined}
                  message={rowMessage}
                >
                  <img
                    src={image.src}
                    alt=""
                    width={image.width}
                    height={image.height}
                  />
                  <span className="grow">
                    <span className="lrow__title">{row.title}</span>
                    <span className="sr-only">, </span>
                    <span className="lrow__meta">{row.meta}</span>
                  </span>
                  <span className="lrow__end">
                    {row.locked && (
                      <>
                        <Icon name="lock-fill" className="lrow__lock" />
                        <span className="sr-only">, đã khoá</span>
                      </>
                    )}
                    {row.done && (
                      <>
                        <Icon name="check-circle" className="lrow__check" />
                        <span className="sr-only">, đã học xong</span>
                      </>
                    )}
                    {row.count && (
                      <>
                        <span className="sr-only">, </span>
                        <span className="lrow__count">
                          {row.count.label}
                          <span className="sr-only">{` ${row.count.tail}`}</span>
                        </span>
                        <span className="progress lrow__bar" aria-hidden="true">
                          <span className={percentClass(row.count.percent)} />
                        </span>
                      </>
                    )}
                  </span>
                </ToastButton>
              </li>
            );
          })}
        </ul>

        <ToastButton
          className="lesson-cta"
          aria-disabled={locked ? 'true' : undefined}
          message={rowMessage}
        >
          Tiếp tục học
          <Icon name="arrow-right" />
        </ToastButton>
      </main>
    </>
  );
}
