import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { LearnerLogoutButton } from '@/features/learner-auth/learner-logout-button';
import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';

export const metadata: Metadata = {
  title: 'Góc học tập',
};

export default async function LearnerHomePage() {
  const session = await getServerLearnerSession();
  if (session.state !== 'learner') {
    redirect('/sign-in');
  }

  return (
    <main className="app auth">
      <h1 className="auth__title">
        Xin chào, <span>{session.user.email}</span>
      </h1>
      <p className="auth__subtitle">
        Chào mừng bạn đã trở lại với Hán Lộ. Hãy sẵn sàng cho bài học tiếp theo!
      </p>

      <LearnerLogoutButton />
    </main>
  );
}
