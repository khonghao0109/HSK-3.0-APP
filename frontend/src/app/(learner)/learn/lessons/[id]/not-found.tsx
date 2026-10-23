import Link from 'next/link';

import { LearnerBackButton } from '@/features/learner-auth/learner-back-button';
import { LearnerWebTopbar } from '@/features/learner-shell/learner-web-topbar';

/** Missing, unready or malformed lesson id (Q41). */
export default function LessonNotFound() {
  return (
    <>
      {/* M2.10b: the .w-app frame's top bar (mẫu web/lesson-not-found.html). */}
      <LearnerWebTopbar />
      <header className="m02-head m02-bar m-only">
        <LearnerBackButton
          fallbackHref="/learn/path"
          ariaLabel="Quay lại lộ trình"
        />
        <p className="m02-bar__title">Bài học</p>
      </header>

      <main className="m02-sheet lesson-nf">
        {/* M2.10b: web breadcrumbs replace the mobile back bar. */}
        <nav className="w-crumbs w-only" aria-label="Vị trí">
          <Link href="/learn/path">Lộ trình học</Link>
          <svg className="icon icon--sm" aria-hidden="true">
            <use href="#i-chevron-right" />
          </svg>
          <span aria-current="page">Bài học</span>
        </nav>
        <div className="lesson-nf__body">
          <span className="lesson-nf__art" aria-hidden="true">
            <svg className="icon">
              <use href="#i-book-open" />
            </svg>
          </span>
          <h1 className="lesson-nf__title">Không tìm thấy bài học</h1>
          <p className="lesson-nf__text">
            Bài học này không tồn tại hoặc chưa mở.
          </p>
          <Link className="lesson-nf__cta" href="/learn/path">
            Về lộ trình
          </Link>
        </div>
      </main>
    </>
  );
}
