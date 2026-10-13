import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { LearnerLoginForm } from '@/features/learner-auth/learner-login-form';
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

      <LearnerLoginForm nextPath={nextPath} />
    </main>
  );
}
