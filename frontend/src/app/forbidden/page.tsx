import type { Metadata } from 'next';
import Link from 'next/link';

import { adminFontClassNames } from '@/features/admin-shell/admin-fonts';
import { AdminIcon } from '@/features/admin-shell/admin-icon';
import { AdminIconSprite } from '@/features/admin-shell/admin-icon-sprite';

import '../admin/admin.css';

export const metadata: Metadata = {
  title: { absolute: 'Không có quyền truy cập · Hán Lộ Admin' },
};

export default function ForbiddenPage() {
  return (
    <div className={['admin-app', ...adminFontClassNames].join(' ')}>
      <AdminIconSprite />
      <main className="adm-state-page">
        <div className="adm-state-card">
          <span className="adm-state-card__brand">
            <span className="adm-brand__mark">
              <AdminIcon name="leaf" className="adm-icon adm-icon--sm" />
            </span>
            Hán Lộ Admin
          </span>
          <span className="adm-mono adm-muted">403</span>
          <span className="adm-state-card__mark adm-state-card__mark--danger">
            <AdminIcon name="alert-triangle" />
          </span>
          <h1>Không có quyền truy cập</h1>
          <p>
            Khu vực này chỉ dành cho tài khoản quản trị Hán Lộ đang hoạt động.
          </p>
          <div className="adm-state-card__actions">
            <Link
              className="adm-btn adm-btn--primary adm-btn--block"
              href="/login"
            >
              Đăng nhập
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
