import type { Metadata } from 'next';

import { LearnerBackButton } from '@/features/learner-auth/learner-back-button';

export const metadata: Metadata = {
  title: 'Chính sách bảo mật',
};

export default function PrivacyPage() {
  return (
    <div className="app">
      <header className="appbar">
        <LearnerBackButton fallbackHref="/" className="icon-btn" />
        <span className="appbar__title">Bảo mật</span>
        <span></span>
      </header>
      <main className="static-page">
        <h1>Chính sách bảo mật</h1>
        <p className="muted">Nội dung đang được cập nhật.</p>
      </main>
    </div>
  );
}
