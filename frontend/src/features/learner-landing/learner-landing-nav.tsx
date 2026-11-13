import Link from 'next/link';

import { LearnerBrand } from '@/features/learner-shell/learner-brand';

import {
  LANDING_NAV,
  LANDING_SIGN_IN_HREF,
  LANDING_SIGN_UP_HREF,
} from './learner-landing-content';

/**
 * Thanh điều hướng ngang `.w-pubnav` của trang chào bản web (mẫu
 * `docs/ui_reference/web/index.html`). Web-only: `.w-only` đã `display: none`
 * ở cuối `learner.css` nên dưới 1024px nó không tạo box và không vào cây
 * trợ năng; trang chào mobile không có chrome riêng nên không cần `.m-only`
 * tương ứng.
 */
export function LearnerLandingNav() {
  return (
    <header className="w-pubnav w-only">
      <LearnerBrand href="/" />
      <nav aria-label="Giới thiệu">
        {LANDING_NAV.map((item) => (
          <Link key={item.href} href={item.href}>
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="w-pubnav__end">
        <Link className="btn w-btn btn--ghost" href={LANDING_SIGN_IN_HREF}>
          Đăng nhập
        </Link>
        <Link className="btn w-btn w-btn--primary" href={LANDING_SIGN_UP_HREF}>
          Bắt đầu học
        </Link>
      </div>
    </header>
  );
}
