import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MediaLifecycleActions } from './media-mutation';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
});

function stubFetch(status: number) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ success: status < 400 }), { status }),
    );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

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

  describe('keyboard focus (E-02)', () => {
    it('moves focus into the confirmation and returns it to the trigger on cancel', async () => {
      const user = userEvent.setup();
      render(
        <MediaLifecycleActions
          mediaId={41}
          lifecycle="active"
          processingStatus="ready"
        />,
      );
      await user.tab();
      await user.tab();
      expect(
        screen.getByRole('button', { name: 'Archive asset' }),
      ).toHaveFocus();

      await user.keyboard('{Enter}');
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

      await user.keyboard('{Enter}');
      expect(
        screen.getByRole('button', { name: 'Archive asset' }),
      ).toHaveFocus();
      expect(document.activeElement).not.toBe(document.body);
    });

    it('does not archive when Enter is pressed twice on the trigger', async () => {
      const fetchMock = stubFetch(200);
      const user = userEvent.setup();
      render(
        <MediaLifecycleActions
          mediaId={41}
          lifecycle="active"
          processingStatus="ready"
        />,
      );
      screen.getByRole('button', { name: 'Archive asset' }).focus();
      await user.keyboard('{Enter}{Enter}');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(
        screen.getByRole('button', { name: 'Archive asset' }),
      ).toHaveFocus();
    });

    it('returns focus to the confirm button when archive fails', async () => {
      stubFetch(503);
      const user = userEvent.setup();
      render(
        <MediaLifecycleActions
          mediaId={41}
          lifecycle="active"
          processingStatus="ready"
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Archive asset' }));
      await user.click(screen.getByRole('button', { name: 'Confirm archive' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        /temporarily unavailable/i,
      );
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Confirm archive' }),
        ).toHaveFocus(),
      );
    });

    it('focuses the archived notice after a successful archive refresh', async () => {
      const fetchMock = stubFetch(200);
      const user = userEvent.setup();
      const { rerender } = render(
        <MediaLifecycleActions
          mediaId={41}
          lifecycle="active"
          processingStatus="ready"
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Archive asset' }));
      await user.click(screen.getByRole('button', { name: 'Confirm archive' }));
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/media/41/archive',
        expect.objectContaining({ method: 'POST' }),
      );

      rerender(
        <MediaLifecycleActions
          mediaId={41}
          lifecycle="archived"
          processingStatus="ready"
        />,
      );
      expect(screen.getByText(/retained for history/i)).toHaveFocus();
    });

    it('keeps focus in the action group after quarantine', async () => {
      stubFetch(200);
      const user = userEvent.setup();
      const { rerender } = render(
        <MediaLifecycleActions
          mediaId={41}
          lifecycle="active"
          processingStatus="ready"
        />,
      );
      await user.click(
        screen.getByRole('button', { name: 'Quarantine asset' }),
      );
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      rerender(
        <MediaLifecycleActions
          mediaId={41}
          lifecycle="active"
          processingStatus="quarantined"
        />,
      );

      expect(
        screen.getByRole('button', { name: 'Quarantine asset' }),
      ).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'Archive asset' }),
      ).toHaveFocus();
    });

    it('returns focus to quarantine when it fails', async () => {
      stubFetch(409);
      const user = userEvent.setup();
      render(
        <MediaLifecycleActions
          mediaId={41}
          lifecycle="active"
          processingStatus="ready"
        />,
      );
      await user.click(
        screen.getByRole('button', { name: 'Quarantine asset' }),
      );

      expect(await screen.findByRole('alert')).toHaveTextContent(/changed/i);
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Quarantine asset' }),
        ).toHaveFocus(),
      );
    });
  });
});
