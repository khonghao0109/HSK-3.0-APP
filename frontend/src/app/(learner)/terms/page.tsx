import type { Metadata } from 'next';

import { LearnerBackButton } from '@/features/learner-auth/learner-back-button';

export const metadata: Metadata = {
  title: 'Điều khoản sử dụng',
};

export default function TermsPage() {
  return (
    <div className="app">
      <header className="appbar">
        <LearnerBackButton fallbackHref="/" className="icon-btn" />
        <span className="appbar__title">Điều khoản</span>
        <span></span>
      </header>
      <main className="static-page">
        <h1>Điều khoản sử dụng</h1>
        <p className="muted">Nội dung đang được cập nhật.</p>
      </main>
    </div>
  );
}
