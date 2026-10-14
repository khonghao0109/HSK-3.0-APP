import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  LANDING_FAQ,
  LANDING_FEATURES,
  LANDING_HERO,
  LANDING_LEVELS,
  LANDING_STEPS,
  LANDING_SOON,
} from './learner-landing-content';
import { LearnerLandingNav } from './learner-landing-nav';
import { LearnerLandingWeb } from './learner-landing-web';

/**
 * Trang chào bản web (M2.10c, PO Q81/Q84). Cây web và thanh nav là hai
 * component; hợp đồng giữa chúng là ba neo `#levels`/`#features`/`#faq` phải
 * trỏ tới `id` THẬT trên phần tử đích, nên test render cả hai cạnh nhau.
 */
function renderLanding() {
  return render(
    <>
      <LearnerLandingNav />
      <LearnerLandingWeb />
    </>,
  );
}

describe('LearnerLandingNav', () => {
  it('points its three anchors at ids that exist in the web tree', () => {
    const { container } = render(
      <>
        <LearnerLandingNav />
        <LearnerLandingWeb />
      </>,
    );
    const nav = screen.getByRole('navigation', { name: 'Giới thiệu' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#levels',
      '#features',
      '#faq',
    ]);
    for (const link of links) {
      const href = link.getAttribute('href') ?? '';
      expect(href.startsWith('#')).toBe(true);
      expect(container.querySelector(href), `đích của ${href}`).not.toBeNull();
    }
  });

  it('keeps the primary call to action on jade-800 (Q74) and the right targets', () => {
    render(<LearnerLandingNav />);
    const signUp = screen.getByRole('link', { name: 'Bắt đầu học' });
    expect(signUp).toHaveAttribute('href', '/sign-up');
    expect(signUp).toHaveClass('w-btn--primary');
    expect(screen.getByRole('link', { name: 'Đăng nhập' })).toHaveAttribute(
      'href',
      '/sign-in',
    );
  });
});

describe('LearnerLandingWeb', () => {
  it('exposes the three anchor targets as real elements', () => {
    const { container } = render(<LearnerLandingWeb />);
    for (const id of ['levels', 'features', 'faq']) {
      expect(container.querySelectorAll(`#${id}`)).toHaveLength(1);
    }
    expect(container.querySelector('#levels')?.tagName).toBe('SECTION');
    expect(container.querySelector('#features')?.tagName).toBe('SECTION');
    expect(container.querySelector('#faq')?.tagName).toBe('SECTION');
  });

  it('keeps exactly one h1 with the sample hero copy', () => {
    render(<LearnerLandingWeb />);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(LANDING_HERO.title);
    expect(headings[0]).toHaveAttribute('id', 'hero-title');
  });

  it('sends both hero actions to /sign-up and /sign-in', () => {
    const { container } = render(<LearnerLandingWeb />);
    const hero = container.querySelector('.lp-hero__cta') as HTMLElement;
    const cta = within(hero).getByRole('link', { name: 'Bắt đầu học' });
    expect(cta).toHaveAttribute('href', '/sign-up');
    expect(
      within(hero).getByRole('link', { name: 'Đăng nhập' }),
    ).toHaveAttribute('href', '/sign-in');
    // Nút chính của luồng chào là jade-800 chữ trắng (Q74).
    expect(cta).toHaveClass('w-btn--primary');
    expect(cta).toHaveClass('w-btn--lg');
    // Mẫu (`web/index.html`) có ba lời gọi "Bắt đầu học": nav, hero và CTA
    // cuối trang — tất cả cùng trỏ /sign-up.
    const all = screen.getAllByRole('link', { name: 'Bắt đầu học' });
    expect(all).toHaveLength(2);
    for (const link of all) {
      expect(link).toHaveAttribute('href', '/sign-up');
    }
  });

  it('renders the seven HSK levels with HSK 7–9 spanning two columns (Q3/Q5)', () => {
    const { container } = render(<LearnerLandingWeb />);
    const items = container.querySelectorAll('#levels .lp-level');
    expect(items).toHaveLength(LANDING_LEVELS.length);
    expect(items).toHaveLength(7);
    expect(items[0]).toHaveTextContent('HSK 1');
    expect(items[0]).toHaveTextContent('~ 500 từ vựng');
    const wide = container.querySelectorAll('#levels .lp-level--wide');
    expect(wide).toHaveLength(1);
    expect(wide[0]).toHaveTextContent('HSK 7–9');
    expect(wide[0]).toHaveTextContent('~ 11.092 từ vựng');
  });

  it('lists the four shipped features and the four "Sắp có" items of Q84', () => {
    const { container } = render(<LearnerLandingWeb />);
    expect(container.querySelectorAll('#features .lp-feature')).toHaveLength(
      LANDING_FEATURES.length,
    );
    expect(container.querySelectorAll('#features .lp-feature')).toHaveLength(4);
    // Luyện nghe đã có (M2.5c) nên nằm trong mô tả Luyện tập, không ở "Sắp có".
    const soon = container.querySelectorAll('#features .lp-soon__item');
    expect(soon).toHaveLength(LANDING_SOON.length);
    expect(soon).toHaveLength(4);
    expect(
      Array.from(soon).map((item) => item.querySelector('b')?.textContent),
    ).toEqual(['Ôn tập', 'Thi thử HSK', 'Phát âm', 'Trợ lý AI']);
    for (const item of Array.from(soon)) {
      expect(item.querySelector('.w-tag--soon')).toHaveTextContent('Sắp có');
    }
    const soonList = container.querySelector('#features .lp-soon');
    expect(soonList).toHaveAttribute('aria-label', 'Tính năng sắp có');
  });

  it('renders the four onboarding steps', () => {
    const { container } = render(<LearnerLandingWeb />);
    expect(container.querySelectorAll('.lp-step')).toHaveLength(
      LANDING_STEPS.length,
    );
    expect(container.querySelectorAll('.lp-step')).toHaveLength(4);
    expect(
      screen.getByRole('heading', { name: /Bắt đầu trong 4 bước/u }),
    ).toBeInTheDocument();
  });

  it('renders the FAQ as native details/summary so the keyboard works without JS', () => {
    const { container } = render(<LearnerLandingWeb />);
    const details = container.querySelectorAll('#faq details');
    expect(details).toHaveLength(LANDING_FAQ.length);
    expect(details).toHaveLength(5);
    for (const item of Array.from(details)) {
      const summary = item.querySelector('summary');
      expect(summary).not.toBeNull();
      // `<summary>` là control gốc, đã nằm trong thứ tự Tab; thêm `tabindex`
      // sẽ tạo điểm dừng Tab thứ hai.
      expect(summary).not.toHaveAttribute('tabindex');
      expect(item.querySelector('p')).not.toBeNull();
      expect(item).not.toHaveAttribute('open');
    }
    expect(screen.getByText('Hán Lộ dạy theo chuẩn nào?')).toBeInTheDocument();
  });

  it('renders the closing call to action to /sign-up', () => {
    const { container } = render(<LearnerLandingWeb />);
    const cta = container.querySelector('.lp-cta');
    expect(cta).not.toBeNull();
    const links = within(cta as HTMLElement).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/sign-up');
    expect(links[0]).toHaveClass('w-btn--primary');
  });

  it('marks the whole tree web-only so nothing leaks below 1024px', () => {
    const { container } = render(<LearnerLandingWeb />);
    expect(container.firstElementChild).toHaveClass('lp-page', 'w-only');
    // Ảnh hero dùng <img> với file trong public (không next/image).
    const img = container.querySelector('.lp-hero__art img');
    expect(img).toHaveAttribute(
      'src',
      '/images/learner/welcome-illustration.png',
    );
    expect(img).toHaveAttribute('alt', '');
  });

  it('uses only one copy of the interactive controls (no form controls at all)', () => {
    const { container } = renderLanding();
    expect(
      container.querySelectorAll('input, textarea, select, form'),
    ).toHaveLength(0);
  });
});
