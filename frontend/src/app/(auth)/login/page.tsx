import type { Metadata } from 'next';
import Link from 'next/link';

import { AdminIcon } from '@/features/admin-shell/admin-icon';
import { LoginForm } from '@/features/auth/login-form';

export const metadata: Metadata = { title: 'Đăng nhập' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const sessionEnded = (await searchParams).reason === 'session';
  return (
    <main className="adm-state-page">
      <section className="adm-state-card" aria-labelledby="login-title">
        <span className="adm-state-card__brand">
          <span className="adm-brand__mark">
            <AdminIcon name="leaf" className="adm-icon adm-icon--sm" />
          </span>
          Hán Lộ Admin
        </span>
        <h1 id="login-title">Đăng nhập</h1>
        <p className="adm-muted">
          Đăng nhập bằng tài khoản quản trị đang hoạt động.
        </p>
        <LoginForm sessionEnded={sessionEnded} />
        <p className="adm-muted">
          Phiên đăng nhập được giữ trong cookie HttpOnly được bảo vệ.
        </p>
        <Link className="adm-link" href="/admin/exercises">
          Về trang Bài tập
        </Link>
      </section>
    </main>
  );
}
