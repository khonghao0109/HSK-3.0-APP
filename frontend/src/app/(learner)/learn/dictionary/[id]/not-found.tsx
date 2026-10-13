import Link from 'next/link';

import { LearnerBackButton } from '@/features/learner-auth/learner-back-button';
import { LearnerWebTopbar } from '@/features/learner-shell/learner-web-topbar';

/** Missing, unpublished or malformed word id (Tech Lead, as Q41). */
export default function WordNotFound() {
  return (
    <>
      <LearnerWebTopbar />
      <header className="m02-head m02-bar">
        <LearnerBackButton
          fallbackHref="/learn/dictionary"
          ariaLabel="Quay lại Tra từ"
        />
        <p className="m02-bar__title">Từ điển</p>
      </header>

      <main className="m02-sheet lesson-nf">
        <div className="lesson-nf__body">
          <span className="lesson-nf__art" aria-hidden="true">
            <svg className="icon">
              <use href="#i-search" />
            </svg>
          </span>
          <h1 className="lesson-nf__title">Không tìm thấy từ</h1>
          <p className="lesson-nf__text">
            Từ này không có trong từ điển hoặc chưa được công bố.
          </p>
          <Link className="lesson-nf__cta" href="/learn/dictionary">
            Về Tra từ
          </Link>
        </div>
      </main>
    </>
  );
}
