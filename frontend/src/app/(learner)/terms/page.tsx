import type { Metadata } from 'next';
import Link from 'next/link';

import { LearnerBackButton } from '@/features/learner-auth/learner-back-button';
import { LearnerBrand } from '@/features/learner-shell/learner-brand';
import { LearnerPublicFooter } from '@/features/learner-shell/learner-public-footer';

export const metadata: Metadata = {
  title: 'Điều khoản sử dụng',
};

/**
 * `/terms`. Dưới 1024px giữ nguyên trang tĩnh mobile (appbar + `main.static-page`,
 * K3a); từ 1024px cây web `.w-wrap.legal` của `docs/ui_reference/web/terms.html`
 * hiện ra, appbar bị `.m-only` ẩn.
 *
 * Chỉ MỘT `<main>` trong DOM: cây web nằm trong chính `main.static-page` dưới
 * dạng `.w-only`, vì `learner-a11y.spec.ts` đếm `page.locator('main')` không
 * lọc theo hiển thị.
 *
 * Nội dung pháp lý thật gắn M1.7b2; câu "Nội dung đang được cập nhật." của
 * app hiện tại được giữ nguyên, không bịa nội dung.
 */
export default function TermsPage() {
  return (
    <div className="w-public">
      <header className="w-pubnav w-only">
        <LearnerBrand href="/" />
        <div className="w-pubnav__end">
          <Link className="btn w-btn btn--outline" href="/sign-in">
            Đăng nhập
          </Link>
        </div>
      </header>

      <div className="app">
        <header className="appbar m-only">
          <LearnerBackButton fallbackHref="/" className="icon-btn" />
          <span className="appbar__title">Điều khoản</span>
          <span></span>
        </header>

        <main className="static-page">
          <h1 className="m-only">Điều khoản sử dụng</h1>
          <p className="muted m-only">Nội dung đang được cập nhật.</p>

          <div className="w-wrap legal w-only">
            <nav className="legal__toc" aria-label="Tài liệu pháp lý">
              <p className="legal__toc-title" aria-hidden="true">
                Tài liệu pháp lý
              </p>
              <ul>
                <li>
                  <Link href="/terms" aria-current="page">
                    <svg className="icon" aria-hidden="true">
                      <use href="#i-file-text" />
                    </svg>
                    Điều khoản sử dụng
                  </Link>
                </li>
                <li>
                  <Link href="/privacy">
                    <svg className="icon" aria-hidden="true">
                      <use href="#i-file-text" />
                    </svg>
                    Chính sách bảo mật
                  </Link>
                </li>
              </ul>
            </nav>

            <article className="legal__doc">
              <LearnerBackButton fallbackHref="/" className="legal__back">
                Quay lại
              </LearnerBackButton>
              <h1 className="w-h1">Điều khoản sử dụng</h1>
              <div className="w-card legal__empty">
                <span className="legal__empty-icon" aria-hidden="true">
                  <svg className="icon">
                    <use href="#i-file-text" />
                  </svg>
                </span>
                <p>Nội dung đang được cập nhật.</p>
              </div>
              <p className="w-muted legal__see">
                Xem thêm: <Link href="/privacy">Chính sách bảo mật</Link>
              </p>
            </article>
          </div>
        </main>
      </div>

      <LearnerPublicFooter />
    </div>
  );
}
