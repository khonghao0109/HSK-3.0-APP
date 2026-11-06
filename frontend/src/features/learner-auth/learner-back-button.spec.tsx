import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LearnerBackButton } from './learner-back-button';

const router = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

describe('LearnerBackButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the default name "Quay lại" and fallback href', () => {
    render(<LearnerBackButton />);
    const link = screen.getByRole('link', { name: 'Quay lại' });
    expect(link).toHaveAttribute('href', '/');
    expect(link).toHaveClass('icon-btn');
  });

  it('takes a custom accessible name and fallback', () => {
    render(
      <LearnerBackButton
        fallbackHref="/learn/path"
        ariaLabel="Quay lại lộ trình"
      />,
    );
    const link = screen.getByRole('link', { name: 'Quay lại lộ trình' });
    expect(link).toHaveAttribute('href', '/learn/path');
  });

  it('goes back in history when there is one, else to the fallback', () => {
    render(<LearnerBackButton fallbackHref="/learn/path" />);
    const link = screen.getByRole('link', { name: 'Quay lại' });

    const length = vi.spyOn(window.history, 'length', 'get');
    length.mockReturnValue(2);
    fireEvent.click(link);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();

    length.mockReturnValue(1);
    fireEvent.click(link);
    expect(router.push).toHaveBeenCalledWith('/learn/path');
    length.mockRestore();
  });

  it('draws the arrow by default and the given icon otherwise', () => {
    const { container, rerender } = render(<LearnerBackButton />);
    expect(container.querySelector('use')).toHaveAttribute(
      'href',
      '#i-arrow-left',
    );
    rerender(<LearnerBackButton icon="chevron-left" />);
    expect(container.querySelector('use')).toHaveAttribute(
      'href',
      '#i-chevron-left',
    );
  });
});
