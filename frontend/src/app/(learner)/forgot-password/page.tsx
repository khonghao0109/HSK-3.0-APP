import type { Metadata } from 'next';
import Link from 'next/link';

import { ForgotPasswordForm } from '@/features/learner-account-recovery/forgot-password-form';

export const metadata: Metadata = {
  title: 'Quên mật khẩu',
};

export default function ForgotPasswordPage() {
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
      <ForgotPasswordForm />
    </main>
  );
}
