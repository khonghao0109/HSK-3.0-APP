import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { LearnerLogoutButton } from '@/features/learner-auth/learner-logout-button';
import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import { getLearningHome } from '@/features/learner-home/learning-home-service';
import { isAuthFailure } from '@/lib/api/api-error';

export const metadata: Metadata = {
  title: 'Hồ sơ',
};

/** Minimal profile until module 04/06 ships (Q17): name, email, sign out. */
export default async function LearnerProfilePage() {
  const session = await getServerLearnerSession();
  if (session.state !== 'learner' || !session.token) {
    redirect('/sign-in');
  }

  // Only the display name comes from /learning/home: any failure other than
  // a lost session still renders email and sign-out.
  let greetingName: string | null = null;
  let nameUnavailable = false;
  let authFailed = false;
  try {
    greetingName = (await getLearningHome(session.token)).greetingName;
  } catch (error) {
    if (isAuthFailure(error)) authFailed = true;
    else nameUnavailable = true;
  }

  if (authFailed) {
    redirect('/sign-in');
  }

  return (
    <main className="profile">
      <h1 className="profile__title">Hồ sơ</h1>
      <dl className="profile__card">
        <div className="profile__row">
          <dt>Tên</dt>
          <dd>
            {nameUnavailable
              ? 'Không tải được tên hiển thị.'
              : (greetingName ?? 'Chưa có tên hiển thị')}
          </dd>
        </div>
        <div className="profile__row">
          <dt>Email</dt>
          <dd>{session.user.email}</dd>
        </div>
      </dl>
      <LearnerLogoutButton />
    </main>
  );
}
