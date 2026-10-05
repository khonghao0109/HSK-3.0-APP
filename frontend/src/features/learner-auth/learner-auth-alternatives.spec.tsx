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
