import Link from 'next/link';

import { LearnerBackButton } from '@/features/learner-auth/learner-back-button';

/** Missing, unready or malformed lesson id (Q41). */
export default function LessonNotFound() {
  return (
    <>
      <header className="m02-head m02-bar">
        <LearnerBackButton
          fallbackHref="/learn/path"
          ariaLabel="Quay lại lộ trình"
        />
        <p className="m02-bar__title">Bài học</p>
      </header>

      <main className="m02-sheet lesson-nf">
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
