import Link from 'next/link';

import { LearnerBrand } from './learner-brand';

/**
 * Chân trang `.w-footer` của khung công khai `.w-public` (M2.10c, PO Q81).
 * Dùng chung cho đúng ba trang `/`, `/terms`, `/privacy`; ba nhóm link, cột
 * brand và dòng "© 2026 Hán Lộ" chép từ `docs/ui_reference/web/index.html`
 * (bản `terms.html`/`privacy.html` chỉ khác tiền tố `index.html` ở neo).
 *
 * Web-only: `.w-only` đã `display: none` ở cuối `learner.css`, nên dưới
 * 1024px chân trang không tạo box và không vào cây trợ năng; bản mobile của
 * ba trang đó không có chân trang nào.
 */

export type PublicFooterLink = {
  href: string;
  label: string;
};

export type PublicFooterGroup = {
  /** `id` của `h2` mà `nav` trỏ tới bằng `aria-labelledby`. */
  id: string;
  title: string;
  links: readonly PublicFooterLink[];
};

export const PUBLIC_FOOTER_GROUPS: readonly PublicFooterGroup[] = [
  {
    id: 'foot-product',
    title: 'Giới thiệu',
    links: [
      { href: '/#levels', label: 'Lộ trình HSK' },
      { href: '/#features', label: 'Tính năng' },
      { href: '/#faq', label: 'Câu hỏi thường gặp' },
    ],
  },
  {
    id: 'foot-account',
    title: 'Tài khoản',
    links: [
      { href: '/sign-in', label: 'Đăng nhập' },
      { href: '/sign-up', label: 'Đăng ký' },
    ],
  },
  {
    id: 'foot-legal',
    title: 'Pháp lý',
    links: [
      { href: '/terms', label: 'Điều khoản sử dụng' },
      { href: '/privacy', label: 'Chính sách bảo mật' },
    ],
  },
];

export const PUBLIC_FOOTER_TAGLINE = 'Con đường chinh phục tiếng Trung';
export const PUBLIC_FOOTER_BASE = '© 2026 Hán Lộ';

export function LearnerPublicFooter() {
  return (
    <footer className="w-footer w-only">
      <div className="w-wrap">
        <div className="w-footer__cols">
          <div>
            <LearnerBrand href="/" />
            <p className="lp-foot__tag">{PUBLIC_FOOTER_TAGLINE}</p>
          </div>
          {PUBLIC_FOOTER_GROUPS.map((group) => (
            <nav key={group.id} aria-labelledby={group.id}>
              <h2 id={group.id}>{group.title}</h2>
              <ul>
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <p className="w-footer__base">{PUBLIC_FOOTER_BASE}</p>
      </div>
    </footer>
  );
}
