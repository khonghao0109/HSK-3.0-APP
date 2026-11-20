import type { Metadata } from 'next';
import Link from 'next/link';

import { LearnerBackButton } from '@/features/learner-auth/learner-back-button';
import {
  percentClass,
  wholePercent,
} from '@/features/learner-home/learning-home-contract';
import { levelLabel } from '@/features/learner-home/level-label';
import {
  getLessonActivity,
  getLessonWords,
} from '@/features/learner-lesson/lesson-activity-service';
import { LessonImage } from '@/features/learner-lesson/lesson-image';
import { loadLearnerLesson } from '@/features/learner-lesson/lesson-page-loader';
import {
  LESSON_UNIT_BADGES,
  lessonUnits,
  unitHref,
  type LessonUnit,
} from '@/features/learner-lesson/lesson-sections';
import { LearnerWebTopbar } from '@/features/learner-shell/learner-web-topbar';
import { ToastButton } from '@/features/learner-shell/learner-toast';
import {
  TOAST_COMING_SOON,
  TOAST_LOCKED,
} from '@/features/learner-shell/learner-toast-messages';
import { Icon } from '@/components/ui/icon';

export const metadata: Metadata = {
  title: 'Bài học',
};

/**
 * Lesson page (M2.5a, Q32–Q44) with one "Đơn vị học" row per topic (PO
 * 20/11/2026, mẫu lesson-units.html). Tiếp tục học and Kiểm tra open the
 * player (Q45, N1); Từ vựng / Ngữ pháp / Bài khoá open their topic pages
 * (M2.5f, Q175). Rows of a locked lesson toast (Q44); Kiểm tra stays inert
 * until the units before it are done (N2).
 */
export default async function LearnerLessonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const {
    lessonId,
    data: [activity, { words }],
  } = await loadLearnerLesson((await params).id, (token, id) =>
    Promise.all([getLessonActivity(token, id), getLessonWords(token, id)]),
  );

  const { lesson, level, position } = activity;
  const locked = activity.state === 'locked';
  const percent = wholePercent(activity.progress.completionPercent);
  const description = lesson.description?.trim() || null;
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
          {lesson.coverImage ? (
            <span className="lesson-hero__img lesson-hero__img--cover">
              <LessonImage
                mediaId={lesson.coverImage.id}
                altText={lesson.coverImage.altText}
              />
            </span>
          ) : (
            <span className="lesson-hero__img" aria-hidden="true">
              <Icon name="book-open" />
            </span>
          )}
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
            Đơn vị học
          </h2>
          <ul className="lu-rows">
            {lessonUnits({ ...activity, words }, locked).map((unit) => (
              <li key={unit.key}>
                <UnitRow
                  unit={unit}
                  href={unitHref(lessonId, unit)}
                  lessonLocked={locked}
                />
              </li>
            ))}
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

/** One `.lu-row` (mẫu lesson-units.html): link, lock toast or inert row. */
function UnitRow({
  unit,
  href,
  lessonLocked,
}: {
  unit: LessonUnit;
  href: string;
  lessonLocked: boolean;
}) {
  const badge = LESSON_UNIT_BADGES[unit.kind];
  const className = [
    'lu-row',
    unit.done ? 'is-done' : '',
    unit.locked ? 'is-locked' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const content = (
    <>
      <span
        className={`lu-badge ${unit.locked ? 'is-mute' : badge.tone}`}
        aria-hidden="true"
      >
        {badge.char}
      </span>
      <span className="grow">
        <span className="lu-row__title">{unit.title}</span>
        <span className="sr-only">, </span>
        <span className="lu-row__meta" lang={unit.metaLang ?? undefined}>
          {unit.meta}
        </span>
      </span>
      <span className="lu-row__end">
        {unit.locked ? (
          <>
            <Icon name="lock" className="lu-row__lock" />
            <span className="lu-row__state w-only" aria-hidden="true">
              Đang khoá
            </span>
            <span className="sr-only">, đang khoá</span>
          </>
        ) : unit.done ? (
          <>
            <Icon name="check-circle" />
            <span className="lu-row__state m-only" aria-hidden="true">
              Xong
            </span>
            <span className="lu-row__state w-only" aria-hidden="true">
              Đã học xong
            </span>
            <span className="sr-only">, đã học xong</span>
          </>
        ) : (
          <>
            <span className="sr-only">, đã học </span>
            {`${unit.percent}%`}
            <span className="progress lu-bar w-only" aria-hidden="true">
              <span className={percentClass(unit.percent)} />
            </span>
          </>
        )}
      </span>
    </>
  );
  if (!unit.locked) {
    return (
      <Link className={className} href={href}>
        {content}
      </Link>
    );
  }
  if (lessonLocked) {
    return (
      <ToastButton
        className={className}
        aria-disabled="true"
        message={TOAST_LOCKED}
      >
        {content}
      </ToastButton>
    );
  }
  // Pha B debt 5b: a disabled link, so the row's name (with "Mở khi xong
  // các đơn vị trên") reaches screen readers; Pha C debt 3c: in the Tab
  // order, so keyboard users hear it too.
  return (
    <div className={className} role="link" aria-disabled="true" tabIndex={0}>
      {content}
    </div>
  );
}
