import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LearnerAuthAlternatives } from './learner-auth-alternatives';

describe('LearnerAuthAlternatives', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders divider, social buttons, terms links, and status region', () => {
    render(<LearnerAuthAlternatives />);

    expect(screen.getByText('hoặc')).toHaveClass('divider-text');
    expect(
      screen.getByRole('button', { name: 'Tiếp tục với Google' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Tiếp tục với Apple' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Tiếp tục với Facebook' }),
    ).toBeInTheDocument();

    const termsLink = screen.getByRole('link', { name: 'Điều khoản sử dụng' });
    expect(termsLink).toHaveAttribute('href', '/terms');

    const privacyLink = screen.getByRole('link', {
      name: 'Chính sách bảo mật',
    });
    expect(privacyLink).toHaveAttribute('href', '/privacy');

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows toast when clicking social login button and hides it after timeout', () => {
    render(<LearnerAuthAlternatives />);

    const googleBtn = screen.getByRole('button', {
      name: 'Tiếp tục với Google',
    });
    fireEvent.click(googleBtn);

    const statusRegion = screen.getByRole('status');
    expect(statusRegion).toHaveTextContent('Tính năng sắp ra mắt.');

    act(() => {
      vi.advanceTimersByTime(2500);
    });

    expect(statusRegion).toBeEmptyDOMElement();
  });

  it('clears active toast timer on unmount without throwing errors', () => {
    const { unmount } = render(<LearnerAuthAlternatives />);

    const appleBtn = screen.getByRole('button', {
      name: 'Tiếp tục với Apple',
    });
    fireEvent.click(appleBtn);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Tính năng sắp ra mắt.',
    );

    unmount();

    act(() => {
      vi.advanceTimersByTime(2500);
    });
  });
});

// M2.10c: dòng `.wa-switch` chỉ có ở bản web và do trang truyền vào, ở đúng vị
// trí DOM giữa khối social và `.wa-terms` để thứ tự Tab trùng thứ tự nhìn.
describe('LearnerAuthAlternatives — slot switchLink (M2.10c)', () => {
  it('renders no switch line without the slot (mobile parity)', () => {
    const { container } = render(<LearnerAuthAlternatives />);
    expect(container.querySelector('.wa-switch')).toBeNull();
  });

  it('renders the slot between the social buttons and the legal links', () => {
    const { container } = render(
      <LearnerAuthAlternatives
        switchLink={
          <p className="wa-switch w-only">
            Chưa có tài khoản? <a href="/sign-up">Tạo tài khoản</a>
          </p>
        }
      />,
    );

    const social = container.querySelector('.auth__social')!;
    const switchLine = container.querySelector('.wa-switch')!;
    const terms = container.querySelector('.auth__terms')!;
    const children = [...container.querySelectorAll('*')];
    expect(children.indexOf(social)).toBeLessThan(children.indexOf(switchLine));
    expect(children.indexOf(switchLine)).toBeLessThan(children.indexOf(terms));
    expect(screen.getByRole('link', { name: 'Tạo tài khoản' })).toHaveAttribute(
      'href',
      '/sign-up',
    );
  });
});
