import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { LearnerLoginForm } from '@/features/learner-auth/learner-login-form';
import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';

export const metadata: Metadata = {
  title: 'Đăng nhập',
};

export default async function LearnerSignInPage() {
  const session = await getServerLearnerSession();
  if (session.state === 'learner') {
    redirect('/learn');
  }

  return (
    <main className="app auth">
      <Link className="icon-btn auth__back" href="/" aria-label="Quay lại">
        <svg className="icon" aria-hidden="true">
          <use href="#i-arrow-left" />
        </svg>
      </Link>
      <h1 className="auth__title">
        Chào mừng đến với <span>Hán Lộ</span>
      </h1>
      <p className="auth__subtitle">Đăng nhập để tiếp tục học</p>

      <LearnerLoginForm />
    </main>
  );
}
