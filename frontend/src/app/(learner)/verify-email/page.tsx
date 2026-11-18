import type { Metadata } from 'next';
import Link from 'next/link';

import { VerifyEmailFlow } from '@/features/learner-account-recovery/verify-email-flow';
import {
  LearnerAuthArtTall,
  LearnerAuthBackLink,
  LearnerAuthNav,
} from '@/features/learner-auth/learner-web-auth-chrome';
import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';

export const metadata: Metadata = {
  title: 'Xác thực email',
};

export default async function VerifyEmailPage() {
  const session = await getServerLearnerSession();
  return (
    // Public web frame (M2.10c, Q81); no box below 1024px.
    <div className="w-public">
      <LearnerAuthNav />
      <main className="app auth">
        {/* Left column of the sample's `.w-auth__form`; `display: contents`
            below 1024px, so the mobile flow keeps its own flex items. */}
        <div className="w-public w-auth__form">
          {/* V6: `web/verify-email.html` không có `.wa-back`, nên link này ẩn ở
              bản web (mobile vốn đã ẩn vì mang `.w-only`). */}
          <LearnerAuthBackLink className="wa-back--verify" />
          <Link
            className="icon-btn auth__back m-only"
            href="/"
            aria-label="Quay lại"
          >
            <svg className="icon" aria-hidden="true">
              <use href="#i-arrow-left" />
            </svg>
          </Link>
          <VerifyEmailFlow signedIn={session.state === 'learner'} />
        </div>
        <LearnerAuthArtTall />
      </main>
    </div>
  );
}
