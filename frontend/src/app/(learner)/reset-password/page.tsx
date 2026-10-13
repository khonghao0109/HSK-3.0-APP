import type { Metadata } from 'next';
import Link from 'next/link';

import { ResetPasswordFlow } from '@/features/learner-account-recovery/reset-password-flow';

export const metadata: Metadata = {
  title: 'Đặt lại mật khẩu',
};

export default function ResetPasswordPage() {
  return (
    <main className="app auth">
      <Link
        className="icon-btn auth__back"
        href="/sign-in"
        aria-label="Quay lại"
      >
        <svg className="icon" aria-hidden="true">
          <use href="#i-arrow-left" />
        </svg>
      </Link>
      <ResetPasswordFlow />
    </main>
  );
}
