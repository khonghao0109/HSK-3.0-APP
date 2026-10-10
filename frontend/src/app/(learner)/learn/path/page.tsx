import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import { LearnerPathLevels } from '@/features/learner-path/learner-path-levels';
import type { LearningPath } from '@/features/learner-path/learning-path-contract';
import { getLearningPath } from '@/features/learner-path/learning-path-service';
import { ToastButton } from '@/features/learner-shell/learner-toast';
import { TOAST_COMING_SOON } from '@/features/learner-shell/learner-toast-messages';
import { routeForOnboarding } from '@/features/onboarding/route-for-onboarding';
import { isAuthFailure } from '@/lib/api/api-error';

export const metadata: Metadata = {
  title: 'Lộ trình học',
};

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
      <header className="m02-head path-head">
        <Link className="path-head__logo" href="/learn">
          Hán Lộ
        </Link>
      </header>

      <main className="m02-sheet path-body">
        <LearnerPathLevels
          levels={path.levels}
          initialCode={path.goal?.targetLevelCode ?? 'HSK1'}
        />
      </main>

      {nextLesson && (
        <aside className="path-next" aria-label="Bài tiếp theo">
          <span className="path-next__art" aria-hidden="true">
            <svg className="icon">
              <use href="#i-book-open" />
            </svg>
          </span>
          <div className="grow">
            <p className="path-next__label">Bài tiếp theo</p>
            <p className="path-next__title">{nextLesson.title}</p>
          </div>
          <ToastButton className="path-next__btn" message={TOAST_COMING_SOON}>
            Bắt đầu
            <svg className="icon" aria-hidden="true">
              <use href="#i-arrow-right" />
            </svg>
            <span className="sr-only">{` bài ${nextLesson.title}`}</span>
          </ToastButton>
        </aside>
      )}
    </>
  );
}
