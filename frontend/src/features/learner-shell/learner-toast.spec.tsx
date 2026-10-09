import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LearnerToastProvider,
  TOAST_DURATION_MS,
  ToastButton,
  useLearnerToast,
} from './learner-toast';

function renderButton() {
  return render(
    <LearnerToastProvider>
      <ToastButton message="Xin chào">Bấm</ToastButton>
    </LearnerToastProvider>,
  );
}

function HookUser() {
  useLearnerToast();
  return null;
}

describe('LearnerToastProvider', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a single status live region', () => {
    renderButton();
    const regions = screen.getAllByRole('status');
    expect(regions).toHaveLength(1);
    expect(regions[0]).toHaveAttribute('aria-live', 'polite');
    expect(regions[0]).toBeEmptyDOMElement();
  });

  it('shows the toast text when a ToastButton is clicked', () => {
    renderButton();
    const button = screen.getByRole('button', { name: 'Bấm' });
    expect(button).toHaveAttribute('type', 'button');
    fireEvent.click(button);
    const toast = screen.getByText('Xin chào');
    expect(toast).toHaveClass('toast');
    expect(screen.getByRole('status')).toContainElement(toast);
  });

  it('removes the toast after 2400 ms but not before', () => {
    vi.useFakeTimers();
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Bấm' }));
    expect(TOAST_DURATION_MS).toBe(2400);
    act(() => {
      vi.advanceTimersByTime(2399);
    });
    expect(screen.getByText('Xin chào')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Xin chào')).not.toBeInTheDocument();
  });

  it('stacks one toast per click', () => {
    renderButton();
    const button = screen.getByRole('button', { name: 'Bấm' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.getAllByText('Xin chào')).toHaveLength(2);
  });

  it('throws when useLearnerToast is used outside the provider', () => {
    expect(() => render(<HookUser />)).toThrow(
      'useLearnerToast must be used inside LearnerToastProvider',
    );
  });
});
