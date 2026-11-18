import Link from 'next/link';

import { LearnerBrand } from '@/features/learner-shell/learner-brand';

/**
 * Chrome web của nhóm trang công khai "auth" (M2.10c, PO Q81): nav ngang
 * `.w-pubnav.wa-nav` + cột art navy của khung `.w-authpage/.w-auth`.
 *
 * Mọi phần ở đây là trang trí/điều hướng, chỉ có ở bản web, nên bọc `.w-only`
 * (`.learner-app .w-only { display: none }` dưới 1024px, learner.css). Control
 * của form (input, nút submit, nút social) vẫn chỉ có MỘT bản trong DOM; bản
 * web dàn lại bằng `learner-web-auth.css`.
 */

/** Nav ngang của mẫu `web/sign-*.html` (`.w-pubnav.wa-nav`). */
export function LearnerAuthNav() {
  return (
    <header className="w-pubnav wa-nav w-only">
      <LearnerBrand href="/" />
      <Link className="wa-home" href="/">
        <svg className="icon" aria-hidden="true">
          <use href="#i-arrow-left" />
        </svg>
        Về trang chủ
      </Link>
    </header>
  );
}

/**
 * Link "Quay lại đăng nhập" trong cột form của forgot/reset/verify
 * (mẫu `.wa-back`). Bản mobile đã có nút quay lại riêng, nên link này `.w-only`.
 * `className` cho phép trang gọi thêm modifier; verify-email dùng nó để ẩn link
 * ở bản web vì `web/verify-email.html` không có `.wa-back` (V6).
 */
export function LearnerAuthBackLink({ className }: { className?: string }) {
  return (
    <Link
      className={className ? `wa-back w-only ${className}` : 'wa-back w-only'}
      href="/sign-in"
    >
      <svg className="icon" aria-hidden="true">
        <use href="#i-arrow-left" />
      </svg>
      Quay lại đăng nhập
    </Link>
  );
}

/**
 * Dòng `.wa-switch` của mẫu web: sign-in trỏ sang /sign-up và ngược lại. Bản
 * mobile cố ý không có link này (test "does not contain previous account link
 * text" của M2.1c), nên nó `.w-only` và chỉ được truyền vào form ở bản web qua
 * slot `switchLink`.
 */
export function LearnerAuthSwitch({
  target,
}: {
  target: 'sign-in' | 'sign-up';
}) {
  const toSignUp = target === 'sign-up';
  return (
    <p className="wa-switch w-only">
      {toSignUp ? 'Chưa có tài khoản? ' : 'Đã có tài khoản? '}
      <Link href={toSignUp ? '/sign-up' : '/sign-in'}>
        {toSignUp ? 'Tạo tài khoản' : 'Đăng nhập'}
      </Link>
    </p>
  );
}

/** Ba gạch đầu dòng của art cao (mẫu `.wa-points`). */
const AUTH_POINTS = [
  'Bài học ngắn, học mỗi ngày',
  'Từ vựng có pinyin, nghĩa và phát âm',
  'Theo dõi tiến độ theo từng cấp',
];

/**
 * Art cao `wa-art--tall` của sign-in, sign-up và verify-email: ảnh minh hoạ,
 * câu giá trị và 3 gạch đầu dòng. Mẫu dùng `#i-check-circle-line` (V5).
 */
export function LearnerAuthArtTall() {
  return (
    <aside className="w-auth__art wa-art wa-art--tall w-only">
      <figure>
        <img
          src="/images/learner/welcome-illustration.png"
          alt=""
          width={310}
          height={492}
        />
      </figure>
      <h2>Học tiếng Trung theo lộ trình HSK 3.0</h2>
      <ul className="wa-points">
        {AUTH_POINTS.map((point) => (
          <li key={point}>
            <svg className="icon" aria-hidden="true">
              <use href="#i-check-circle-line" />
            </svg>
            {point}
          </li>
        ))}
      </ul>
    </aside>
  );
}

/**
 * Art rộng `wa-art--wide` của forgot-password và reset-password: ảnh
 * placement-hero 316×136 (chép từ `docs/ui_reference/shared/img/`) và câu về
 * bảo vệ tài khoản.
 */
export function LearnerAuthArtWide() {
  return (
    <aside className="w-auth__art wa-art wa-art--wide w-only">
      <figure>
        <img
          src="/images/learner/placement-hero.png"
          alt=""
          width={316}
          height={136}
        />
      </figure>
      <h2>Tài khoản của bạn được bảo vệ</h2>
      <p>
        Liên kết trong email chỉ dùng được một lần và có thời hạn. Tiến độ học
        của bạn luôn được giữ nguyên.
      </p>
    </aside>
  );
}
