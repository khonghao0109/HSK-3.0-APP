import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { redirect, session } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  session: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/features/learner-auth/server-learner-session', () => ({
  getServerLearnerSession: session,
}));

import LearnerWelcomePage, { metadata } from './page';

/**
 * `/` (M2.10c, PO Q81/Q84). Hai ràng buộc của trang này không nằm ở phần nhìn
 * thấy nên phải khoá bằng test:
 *
 * 1. Cây mobile `.app.welcome` giữ nguyên từng pixel dưới 1024px (K3a) và chỉ
 *    bị `.m-only` ẩn từ 1024px; cây web `.lp-page.w-only` thì ngược lại.
 * 2. DOM chỉ có MỘT `<main>`: `learner-a11y.spec.ts` đếm
 *    `page.locator('main')` (không lọc theo hiển thị) và `learner-web.spec.ts`
 *    cũng giả định một `main` mỗi trang.
 */
describe('learner welcome page (M2.10c)', () => {
  beforeEach(() => {
    session.mockReset();
    redirect.mockClear();
  });

  it('redirects a signed-in learner to /learn', async () => {
    session.mockResolvedValue({
      state: 'learner',
      user: { id: 1 },
      token: 'token',
    });
    await expect(LearnerWelcomePage()).rejects.toThrow('redirect:/learn');
    expect(redirect).toHaveBeenCalledWith('/learn');
  });

  it('keeps the public title the a11y spec asserts', () => {
    expect(metadata.title).toEqual({
      absolute: 'Hán Lộ — Con đường chinh phục tiếng Trung',
    });
  });

  it('holds one <main> with the mobile tree (m-only) and the web tree (w-only)', async () => {
    session.mockResolvedValue({ state: 'unauthenticated', token: null });
    const { container } = render(await LearnerWelcomePage());

    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelectorAll('.w-public')).toHaveLength(1);

    const main = container.querySelector('main');
    expect(main).toHaveClass('app', 'welcome');

    // Cây mobile: giữ nguyên khối .welcome của learner.css, thêm m-only.
    const art = container.querySelector('.welcome__art');
    const actions = container.querySelector('.welcome__actions');
    expect(art).toHaveClass('m-only');
    expect(actions).toHaveClass('m-only');
    expect(art?.querySelector('.welcome__brand')).not.toBeNull();
    expect(actions?.querySelector('a[href="/sign-up"]')).toHaveTextContent(
      'Bắt đầu học',
    );
    expect(actions?.querySelector('a[href="/sign-in"]')).toHaveTextContent(
      'Đăng nhập',
    );

    // Cây web: một khối .lp-page.w-only duy nhất, nằm trong cùng <main>.
    expect(container.querySelectorAll('.lp-page.w-only')).toHaveLength(1);
    expect(main?.querySelector('.lp-page')).not.toBeNull();
  });

  it('renders the web navigation and the shared footer exactly once, web-only', async () => {
    session.mockResolvedValue({ state: 'unauthenticated', token: null });
    const { container } = render(await LearnerWelcomePage());

    const nav = container.querySelector('.w-pubnav');
    expect(nav).toHaveClass('w-only');
    expect(container.querySelectorAll('.w-pubnav')).toHaveLength(1);

    const footer = container.querySelector('footer.w-footer');
    expect(footer).toHaveClass('w-only');
    expect(container.querySelectorAll('footer')).toHaveLength(1);
    expect(footer?.querySelectorAll('nav')).toHaveLength(3);

    // Two <h1> in the DOM (one per tree); learner-a11y.spec.ts đếm
    // `h1:visible` nên mỗi viewport chỉ thấy đúng một cái.
    const headings = Array.from(container.querySelectorAll('h1'));
    expect(headings).toHaveLength(2);
    expect(headings.map((item) => item.closest('.m-only') !== null)).toEqual([
      true,
      false,
    ]);
    expect(headings.map((item) => item.closest('.w-only') !== null)).toEqual([
      false,
      true,
    ]);
  });
});
