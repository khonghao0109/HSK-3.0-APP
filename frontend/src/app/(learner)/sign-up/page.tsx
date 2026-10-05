import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { LearnerRegisterForm } from '@/features/learner-auth/learner-register-form';
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
    <main className="app auth">
      <Link className="icon-btn auth__back" href="/" aria-label="Quay lại">
        <svg className="icon" aria-hidden="true">
          <use href="#i-arrow-left" />
        </svg>
      </Link>
      <h1 className="auth__title">
        Chào mừng đến với <span>Hán Lộ</span>
      </h1>
      <p className="auth__subtitle">Tạo tài khoản để bắt đầu học</p>

      <LearnerRegisterForm />
    </main>
  );
}
