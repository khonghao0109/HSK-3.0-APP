import type { Metadata } from 'next';
import Link from 'next/link';

import { VerifyEmailFlow } from '@/features/learner-account-recovery/verify-email-flow';
import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';

export const metadata: Metadata = {
  title: 'Xác thực email',
};

export default async function VerifyEmailPage() {
  const session = await getServerLearnerSession();
  return (
    <main className="app auth">
      <Link className="icon-btn auth__back" href="/" aria-label="Quay lại">
        <svg className="icon" aria-hidden="true">
          <use href="#i-arrow-left" />
        </svg>
      </Link>
      <VerifyEmailFlow signedIn={session.state === 'learner'} />
    </main>
  );
}
