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
import { LearnerWebTopbar } from '@/features/learner-shell/learner-web-topbar';
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
      {/* M2.10b: the .w-app frame's top bar (mẫu web/lesson.html). No streak
          chip: this page loads no /learning/home (no new backend request). */}
      <LearnerWebTopbar />
      <header className="m02-head m02-bar m-only">
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
        {/* M2.10b: web breadcrumbs replace the mobile back bar (mẫu
            lesson.html). */}
        <nav className="w-crumbs w-only" aria-label="Vị trí">
          <Link href="/learn/path">Lộ trình học</Link>
          <Icon name="chevron-right" className="icon--sm" />
          <Link href="/learn/path">{levelLabel(level.code)}</Link>
          <Icon name="chevron-right" className="icon--sm" />
          <span aria-current="page">{lesson.title}</span>
        </nav>

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
              className="progress lesson-hero__bar m-only"
              role="progressbar"
              aria-label="Tiến độ bài học"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <span className={percentClass(percent)} />
            </div>
            <p className="lesson-hero__pct m-only">
              <b>{percent}%</b> hoàn thành
            </p>
          </div>
          {/* M2.10b: the web hero card carries the favourite button that the
              mobile top bar shows (mẫu lesson.html .learn-fav). */}
          <ToastButton
            className="icon-btn lesson-fav w-only"
            aria-label="Yêu thích bài học"
            message={TOAST_COMING_SOON}
          >
            <Icon name="heart" />
          </ToastButton>
        </section>

        {/* M2.10d F10: the web content section is a plain section with a
            `.w-h2` head (mẫu lesson.html `.w-section.learn-content`), not a
            card wrapping cards; display:contents below 1024px. */}
        <section
          className="lesson-content"
          aria-labelledby="lesson-content-title"
        >
          <h2 className="lesson-section" id="lesson-content-title">
            Nội dung bài học
          </h2>
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
                        {/* M2.10d F11: the sample's visible done label (mẫu
                            .learn-row__done); web-only, the sr-only line
                            already announces the state. */}
                        <span className="lrow__state w-only" aria-hidden="true">
                          Đã học xong
                        </span>
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
        </section>

        {/* M2.10b: the web progress card (mẫu lesson.html `.learn-prog`).
            Web-only copy: the hero keeps its own progress row below 1024px
            and the mobile CTA stays at the bottom of the sheet. */}
        <aside className="lesson-prog w-only" aria-label="Tiến độ bài học">
          <h2 className="lesson-prog__title">Tiến độ bài học</h2>
          <p className="lesson-prog__pct">
            <b>{percent}%</b> hoàn thành
          </p>
          <div
            className="progress lesson-prog__bar"
            role="progressbar"
            aria-label="Tiến độ bài học"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span className={percentClass(percent)} />
          </div>
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
        </aside>

        {locked ? (
          <ToastButton
            className="lesson-cta m-only"
            aria-disabled="true"
            message={TOAST_LOCKED}
          >
            Tiếp tục học
            <Icon name="arrow-right" />
          </ToastButton>
        ) : (
          <Link className="lesson-cta m-only" href={practiceHref}>
            Tiếp tục học
            <Icon name="arrow-right" />
          </Link>
        )}
      </main>
    </>
  );
}
