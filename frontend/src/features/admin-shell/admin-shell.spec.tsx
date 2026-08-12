import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AdminShell } from './admin-shell';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/media',
}));

const admin = {
  id: 1,
  email: 'admin.frontend@example.test',
  name: 'Content Administrator',
  role: 'admin' as const,
  status: 'active' as const,
};

describe('AdminShell', () => {
  it('renders the authenticated operations shell without unsupported actions', () => {
    render(
      <AdminShell user={admin}>
        <h1>Media</h1>
      </AdminShell>,
    );

    const navigation = screen.getByRole('navigation', {
      name: 'Admin navigation',
    });
    expect(
      within(navigation).getByRole('link', { name: 'Media' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(navigation).getByRole('link', { name: 'Exercises' }),
    ).not.toHaveAttribute('aria-current');
    expect(
      screen.getByRole('banner', { name: 'Admin workspace toolbar' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Admin module navigation' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAccessibleName('Admin content');
    expect(
      screen.queryByRole('button', { name: /create|publish|import|media/i }),
    ).not.toBeInTheDocument();
  });
});
