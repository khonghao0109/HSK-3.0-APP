import type { Metadata } from 'next';
import Link from 'next/link';

import { LearnerBackButton } from '@/features/learner-auth/learner-back-button';
import {
  percentClass,
  wholePercent,
} from '@/features/learner-home/learning-home-contract';
import { levelLabel } from '@/features/learner-home/level-label';
import { getLessonActivity } from '@/features/learner-lesson/lesson-activity-service';
import { loadLearnerLesson } from '@/features/learner-lesson/lesson-page-loader';
import {
  LESSON_ROW_IMAGES,
  lessonRows,
} from '@/features/learner-lesson/lesson-sections';
import { ToastButton } from '@/features/learner-shell/learner-toast';
import {
  TOAST_COMING_SOON,
  TOAST_LOCKED,
} from '@/features/learner-shell/learner-toast-messages';

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
 * Lesson page (M2.5a, Q32–Q44). Tiếp tục học and the Luyện tập row of an
 * open lesson open the player (Q45); the other rows still toast.
 */
export default async function LearnerLessonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { lessonId, data: activity } = await loadLearnerLesson(
    (await params).id,
    getLessonActivity,
  );

  const { lesson, level, position, sections } = activity;
  const locked = activity.state === 'locked';
  const percent = wholePercent(activity.progress.completionPercent);
  const description = lesson.description?.trim() || null;
  const rowMessage = locked ? TOAST_LOCKED : TOAST_COMING_SOON;
  const practiceHref = `/learn/lessons/${lessonId}/practice`;

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
            const content = (
              <>
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
              </>
            );
            return (
              <li key={row.kind}>
                {row.kind === 'practice' && !row.locked ? (
                  <Link className={className} href={practiceHref}>
                    {content}
                  </Link>
                ) : (
                  <ToastButton
                    className={className}
                    aria-disabled={row.locked ? 'true' : undefined}
                    message={rowMessage}
                  >
                    {content}
                  </ToastButton>
                )}
              </li>
            );
          })}
        </ul>

        {locked ? (
          <ToastButton
            className="lesson-cta"
            aria-disabled="true"
            message={TOAST_LOCKED}
          >
            Tiếp tục học
            <Icon name="arrow-right" />
          </ToastButton>
        ) : (
          <Link className="lesson-cta" href={practiceHref}>
            Tiếp tục học
            <Icon name="arrow-right" />
          </Link>
        )}
      </main>
    </>
  );
}
