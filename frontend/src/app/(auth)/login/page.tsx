import type { Metadata } from 'next';
import Link from 'next/link';

import { LoginForm } from '@/features/auth/login-form';

export const metadata: Metadata = { title: 'Admin sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const sessionEnded = (await searchParams).reason === 'session';
  return (
    <main className="login-page">
      <section className="login-story" aria-label="HSK Content Workbench">
        <div className="login-story__brand">
          <span>汉</span>
          <strong>HSK 3.0</strong>
        </div>
        <div className="login-story__copy">
          <p className="eyebrow eyebrow--light">CONTENT OPERATIONS</p>
          <h1>
            Language content,
            <br />
            held to a higher standard.
          </h1>
          <p>
            Inspect exercises, source lineage, media readiness and immutable
            revision history from one calm workspace.
          </p>
        </div>
        <div className="login-story__footer mono">简 · 准 · 可追溯</div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <div className="login-card__mark" aria-hidden="true">
            审
          </div>
          <p className="eyebrow">SECURE ADMIN ACCESS</p>
          <h2>Welcome back</h2>
          <p className="muted">Sign in with an active administrator account.</p>
          <LoginForm sessionEnded={sessionEnded} />
          <p className="security-note">
            <span aria-hidden="true">◆</span> Session credentials stay in a
            protected, HttpOnly cookie.
          </p>
          <Link className="help-link" href="/">
            Return to platform
          </Link>
        </div>
      </section>
    </main>
  );
}
