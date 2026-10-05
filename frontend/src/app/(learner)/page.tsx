import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';

export const metadata: Metadata = {
  title: {
    absolute: 'Hán Lộ — Con đường chinh phục tiếng Trung',
  },
};

export default async function LearnerWelcomePage() {
  const session = await getServerLearnerSession();
  if (session.state === 'learner') {
    redirect('/learn');
  }

  return (
    <main className="app welcome">
      <div className="welcome__art">
        <img
          src="/images/learner/welcome-illustration.png"
          alt=""
          width={310}
          height={492}
        />
        <h1 className="welcome__brand">
          <span className="sr-only">Hán Lộ</span>
          <span aria-hidden="true">
            H<span className="acute" data-base="a">á</span>n Lộ
          </span>
        </h1>
        <p className="welcome__tagline">
          Con đường chinh phục<br /> tiếng Trung
        </p>
        <p className="welcome__hanzi" lang="zh-Hans" aria-hidden="true">
          汉路
        </p>
      </div>
      <nav className="welcome__actions" aria-label="Bắt đầu">
        <Link className="btn btn--primary btn--block" href="/sign-up">
          Bắt đầu học
          <span className="btn__end">
            <svg className="icon" aria-hidden="true">
              <use href="#i-chevron-right" />
            </svg>
          </span>
        </Link>
        <Link className="btn btn--outline-navy btn--block" href="/sign-in">
          Đăng nhập
        </Link>
      </nav>
    </main>
  );
}
