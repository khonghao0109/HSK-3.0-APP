import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { LearnerLoginForm } from '@/features/learner-auth/learner-login-form';
import {
  LearnerAuthArtTall,
  LearnerAuthNav,
  LearnerAuthSwitch,
} from '@/features/learner-auth/learner-web-auth-chrome';
import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';

export const metadata: Metadata = {
  title: 'Đăng nhập',
};

export default async function LearnerSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  // Only the exact value `verify-email` is honoured (Q73); any other `next`
  // is ignored, so sign-in never redirects anywhere else.
  const { next } = await searchParams;
  const nextPath = next === 'verify-email' ? '/verify-email' : undefined;
  const session = await getServerLearnerSession();
  if (session.state === 'learner') {
    redirect(nextPath ?? '/learn');
  }

  return (
    // `.w-public` is the public web frame (M2.10c, Q81): it generates no box
    // below 1024px (learner-web-public.css), so the mobile page below stays
    // exactly what it was.
    <div className="w-public">
      <LearnerAuthNav />
      <main className="app auth">
        {/*
         * `.w-public` again on the form column: it is the only wrapper that
         * already resolves to `display: contents` below 1024px, so the mobile
         * flex items of `main.auth` keep their own flow while
         * `learner-web-auth.css` turns this into the sample's left column
         * (`.w-auth__form`). Same trick as the M2.10b hooks in learner.css.
         */}
        <div className="w-public w-auth__form">
          <Link
            className="icon-btn auth__back m-only"
            href="/"
            aria-label="Quay lại"
          >
            <svg className="icon" aria-hidden="true">
              <use href="#i-arrow-left" />
            </svg>
          </Link>
          <h1 className="auth__title">
            Chào mừng đến với <span>Hán Lộ</span>
          </h1>
          <p className="auth__subtitle">Đăng nhập để tiếp tục học</p>

          <LearnerLoginForm
            nextPath={nextPath}
            switchLink={<LearnerAuthSwitch target="sign-up" />}
          />
        </div>
        <LearnerAuthArtTall />
      </main>
    </div>
  );
}
