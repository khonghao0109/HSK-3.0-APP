import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MediaLifecycleActions } from './media-mutation';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe('MediaLifecycleActions', () => {
  it('requires an explicit confirmation before archive', () => {
    render(
      <MediaLifecycleActions
        mediaId={41}
        lifecycle="active"
        processingStatus="ready"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Archive asset' }));
    expect(
      screen.getByRole('group', { name: 'Confirm archive asset' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Confirm archive' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.queryByRole('button', { name: 'Confirm archive' }),
    ).not.toBeInTheDocument();
  });

  it('disables quarantine after quarantine and hides all actions after archive', () => {
    const { rerender } = render(
      <MediaLifecycleActions
        mediaId={41}
        lifecycle="active"
        processingStatus="quarantined"
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Quarantine asset' }),
    ).toBeDisabled();
    rerender(
      <MediaLifecycleActions
        mediaId={41}
        lifecycle="archived"
        processingStatus="quarantined"
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/retained for history/i)).toBeInTheDocument();
  });
});
