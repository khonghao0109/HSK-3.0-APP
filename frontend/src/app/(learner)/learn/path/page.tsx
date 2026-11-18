import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import { levelLabel } from '@/features/learner-home/level-label';
import { LearnerWebTopbar } from '@/features/learner-shell/learner-web-topbar';
import { LearnerPathLevels } from '@/features/learner-path/learner-path-levels';
import type { LearningPath } from '@/features/learner-path/learning-path-contract';
import { getLearningPath } from '@/features/learner-path/learning-path-service';
import { routeForOnboarding } from '@/features/onboarding/route-for-onboarding';
import { isAuthFailure } from '@/lib/api/api-error';

export const metadata: Metadata = {
  title: 'Lộ trình học',
};

/**
 * "Bài tiếp theo" card. Two copies exist on purpose (M2.10d F4): the early
 * `.path-mid` copy shows only at 1024–1279px, where the card sits above the
 * lesson grid (mẫu web/path.html), so the Tab order matches the visual
 * order; the late `.path-next` copy keeps the mobile bar and the ≥ 1280px
 * aside slot. Exactly one copy is visible per viewport.
 */
function NextLessonCard({
  nextLesson,
  mid,
}: {
  nextLesson: NonNullable<LearningPath['nextLesson']>;
  mid?: boolean;
}) {
  const cls = mid ? 'path-mid' : 'path-next';
  return (
    <aside className={cls} aria-label="Bài tiếp theo">
      <span className={`${cls}__art`} aria-hidden="true">
        <svg className="icon">
          <use href="#i-book-open" />
        </svg>
      </span>
      <div className="grow">
        <p className={`${cls}__label`}>Bài tiếp theo</p>
        <p className={`${cls}__title`}>{nextLesson.title}</p>
        <p className={`${cls}__meta w-only`}>
          {`${levelLabel(nextLesson.levelCode)} • Bài ${nextLesson.position}`}
        </p>
      </div>
      <Link
        className={`${cls}__btn`}
        href={`/learn/lessons/${nextLesson.lessonId}`}
      >
        Bắt đầu
        <svg className="icon" aria-hidden="true">
          <use href="#i-arrow-right" />
        </svg>
        <span className="sr-only">{` bài ${nextLesson.title}`}</span>
      </Link>
    </aside>
  );
}

export default async function LearnerPathPage() {
  const session = await getServerLearnerSession();
  if (session.state !== 'learner' || !session.token) {
    redirect('/sign-in');
  }

  let path: LearningPath | null = null;
  let authFailed = false;
  try {
    path = await getLearningPath(session.token);
  } catch (error) {
    if (!isAuthFailure(error)) throw error;
    authFailed = true;
  }

  if (authFailed || !path) {
    redirect('/sign-in');
  }

  if (path.nextStep !== 'ready') {
    redirect(routeForOnboarding(path, path.goal) ?? '/onboarding/goal');
  }

  const { nextLesson } = path;

  return (
    <>
      <LearnerWebTopbar />
      <header className="m02-head path-head">
        <Link className="path-head__logo" href="/learn">
          Hán Lộ
        </Link>
      </header>

      <main className="m02-sheet path-body">
        <LearnerPathLevels
          levels={path.levels}
          initialCode={path.goal?.targetLevelCode ?? 'HSK1'}
          midCard={
            nextLesson ? <NextLessonCard nextLesson={nextLesson} mid /> : null
          }
        />
      </main>

      {nextLesson && <NextLessonCard nextLesson={nextLesson} />}
    </>
  );
}
