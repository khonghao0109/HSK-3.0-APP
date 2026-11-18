import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SEARCH_QUERY_MAX_LENGTH } from '@/features/learner-dictionary/dictionary-display';

import { LearnerToastProvider } from './learner-toast';
import { TOAST_NOTIFICATIONS } from './learner-toast-messages';
import { LearnerWebTopbar } from './learner-web-topbar';

function renderTopbar(props: Parameters<typeof LearnerWebTopbar>[0] = {}) {
  return render(
    <LearnerToastProvider>
      <LearnerWebTopbar {...props} />
    </LearnerToastProvider>,
  );
}

describe('LearnerWebTopbar', () => {
  it('searches Tra từ with a GET form on ?q=', () => {
    const { container } = renderTopbar();
    const box = screen.getByRole('searchbox', { name: 'Tra từ' });
    expect(box).toHaveAttribute('name', 'q');
    const form = screen.getByRole('search');
    expect(form).toHaveAttribute('action', '/learn/dictionary');
    expect(form.getAttribute('method') ?? 'get').toBe('get');
    expect(container.firstElementChild).toHaveClass('w-top', 'w-only');
  });

  // M2.10d (F13): the box caps the query at the length the API accepts.
  it('caps the search box at SEARCH_QUERY_MAX_LENGTH', () => {
    renderTopbar();
    expect(screen.getByRole('searchbox', { name: 'Tra từ' })).toHaveAttribute(
      'maxLength',
      String(SEARCH_QUERY_MAX_LENGTH),
    );
  });

  it('does not render the search box on Tra từ (Q85)', () => {
    const { container } = renderTopbar({ search: false });
    expect(screen.queryByRole('search')).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
    expect(screen.getByRole('button', { name: 'Thông báo' })).toBeVisible();
  });

  it('toasts from the bell and links the avatar to Hồ sơ, no sign-out', () => {
    renderTopbar();
    fireEvent.click(screen.getByRole('button', { name: 'Thông báo' }));
    expect(screen.getByText(TOAST_NOTIFICATIONS)).toHaveClass('toast');
    expect(screen.getByRole('link', { name: 'Hồ sơ' })).toHaveAttribute(
      'href',
      '/learn/profile',
    );
    expect(screen.queryByRole('button', { name: /Đăng xuất/u })).toBeNull();
  });

  it('shows the streak chip only with data from the page (Q83)', () => {
    const { container, unmount } = renderTopbar();
    expect(container.querySelector('.w-chip')).toBeNull();
    unmount();
    renderTopbar({ streakDays: 4 });
    expect(document.querySelector('.w-chip')).toHaveTextContent(
      'Chuỗi ngày học: 4 ngày',
    );
  });
});
