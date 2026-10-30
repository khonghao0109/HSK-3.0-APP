import type { Metadata } from 'next';
import Link from 'next/link';

import { ResetPasswordFlow } from '@/features/learner-account-recovery/reset-password-flow';
import {
  LearnerAuthArtWide,
  LearnerAuthBackLink,
  LearnerAuthNav,
} from '@/features/learner-auth/learner-web-auth-chrome';

export const metadata: Metadata = {
  title: 'Đặt lại mật khẩu',
};

export default function ResetPasswordPage() {
  return (
    // Public web frame (M2.10c, Q81); no box below 1024px.
    <div className="w-public">
      <LearnerAuthNav />
      <main className="app auth">
        {/* Left column of the sample's `.w-auth__form`; `display: contents`
            below 1024px, so the mobile flow keeps its own flex items. */}
        <div className="w-public w-auth__form">
          <LearnerAuthBackLink />
          <Link
            className="icon-btn auth__back m-only"
            href="/sign-in"
            aria-label="Quay lại"
          >
            <svg className="icon" aria-hidden="true">
              <use href="#i-arrow-left" />
            </svg>
          </Link>
          <ResetPasswordFlow />
        </div>
        <LearnerAuthArtWide />
      </main>
    </div>
  );
}
