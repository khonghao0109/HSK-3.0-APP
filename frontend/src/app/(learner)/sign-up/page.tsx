import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { LearnerRegisterForm } from '@/features/learner-auth/learner-register-form';
import {
  LearnerAuthArtTall,
  LearnerAuthNav,
  LearnerAuthSwitch,
} from '@/features/learner-auth/learner-web-auth-chrome';
import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';

export const metadata: Metadata = {
  title: 'Tạo tài khoản',
};

export default async function LearnerSignUpPage() {
  const session = await getServerLearnerSession();
  if (session.state === 'learner') {
    redirect('/learn');
  }

  return (
    // Public web frame (M2.10c, Q81); no box below 1024px.
    <div className="w-public">
      <LearnerAuthNav />
      <main className="app auth">
        {/* Left column of the sample's `.w-auth__form`; `display: contents`
            below 1024px, so the mobile flow keeps its own flex items. */}
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
          <p className="auth__subtitle">Tạo tài khoản để bắt đầu học</p>

          <LearnerRegisterForm
            switchLink={<LearnerAuthSwitch target="sign-in" />}
          />
        </div>
        <LearnerAuthArtTall />
      </main>
    </div>
  );
}
