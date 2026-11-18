import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MEDIA_PREVIEW_MESSAGES,
  MediaPreview,
  previewKind,
} from './media-preview';

const SRC = `/api/admin/media/7/content?expires=1791000000&signature=${'ab'.repeat(32)}`;

function asset(
  over: Partial<Parameters<typeof MediaPreview>[0]['asset']> = {},
) {
  return {
    id: 7,
    filename: 'tone.wav',
    type: 'audio',
    mimeType: 'audio/wav',
    processingStatus: 'ready',
    lifecycle: 'active',
    ...over,
  };
}

function stubGrant(expiresAt: string) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ success: true, data: { src: SRC, expiresAt } }),
      {
        status: 200,
      },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('previewKind (TL-55)', () => {
  it.each([
    [{}, 'audio'],
    [{ mimeType: 'audio/mpeg' }, 'audio'],
    [{ type: 'image', mimeType: 'image/png' }, 'image'],
    [{ type: 'image', mimeType: 'image/jpeg' }, 'image'],
    [{ type: 'image', mimeType: 'image/gif' }, null],
    [{ type: 'pdf', mimeType: 'application/pdf' }, null],
    [{ processingStatus: 'quarantined' }, null],
    [{ lifecycle: 'archived' }, null],
    [{ mimeType: null }, null],
  ])('%o → %s', (over, kind) => {
    expect(previewKind(asset(over))).toBe(kind);
  });
});

describe('MediaPreview (TL-55)', () => {
  it('shows the static sentence and calls nothing for a non-previewable asset', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MediaPreview
        asset={asset({ type: 'pdf', mimeType: 'application/pdf' })}
      />,
    );
    expect(
      screen.getByText(MEDIA_PREVIEW_MESSAGES.unavailable),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads an image grant on mount into a framed <img>', async () => {
    const fetchMock = stubGrant('2026-10-21T10:00:00.000Z');
    render(
      <MediaPreview
        asset={asset({
          type: 'image',
          mimeType: 'image/png',
          filename: 'dot.png',
        })}
      />,
    );
    expect(
      screen.getByText(MEDIA_PREVIEW_MESSAGES.loading),
    ).toBeInTheDocument();
    const image = await screen.findByRole('img', { name: 'Xem trước dot.png' });
    expect(image).toHaveAttribute('src', SRC);
    expect(image.parentElement).toHaveClass('adm-media-preview__frame');
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/media/7/access', {
      credentials: 'same-origin',
    });
    fireEvent.error(image);
    expect(screen.getByText(MEDIA_PREVIEW_MESSAGES.failed)).toBeInTheDocument();
  });

  it('fetches audio only on "Nghe thử" and never autoplays', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play');
    const fetchMock = stubGrant(new Date(Date.now() + 600_000).toISOString());
    const { container } = render(<MediaPreview asset={asset()} />);
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Nghe thử' }));
    await waitFor(() =>
      expect(container.querySelector('audio')).not.toBeNull(),
    );
    const audio = container.querySelector('audio');
    expect(audio).toHaveAttribute('src', SRC);
    expect(audio).toHaveAttribute('preload', 'none');
    expect(audio?.autoplay).toBe(false);
    expect(play).not.toHaveBeenCalled();
    play.mockRestore();
  });

  it('drops the grant at its expiresAt and returns focus to "Nghe thử"', async () => {
    stubGrant(new Date(Date.now() + 1_500).toISOString());
    const { container } = render(<MediaPreview asset={asset()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Nghe thử' }));
    await waitFor(() =>
      expect(container.querySelector('audio')).not.toBeNull(),
    );
    await waitFor(() => expect(container.querySelector('audio')).toBeNull(), {
      timeout: 5_000,
    });
    expect(
      screen.getByText(MEDIA_PREVIEW_MESSAGES.expired),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Nghe thử' })).toHaveFocus(),
    );
  });

  it('moves keyboard focus from "Nghe thử" to the labelled <audio> (V2)', async () => {
    stubGrant(new Date(Date.now() + 600_000).toISOString());
    render(<MediaPreview asset={asset()} />);
    screen.getByRole('button', { name: 'Nghe thử' }).focus();
    await userEvent.keyboard('{Enter}');
    const audio = await screen.findByLabelText('Nghe thử tone.wav');
    expect(audio.tagName).toBe('AUDIO');
    await waitFor(() => expect(document.activeElement).toBe(audio));
  });

  it('keeps focus the user moved outside the preview when the grant expires (N1)', async () => {
    stubGrant(new Date(Date.now() + 1_500).toISOString());
    const { container } = render(
      <>
        <button type="button">Khác</button>
        <MediaPreview asset={asset()} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Nghe thử' }));
    await waitFor(() =>
      expect(container.querySelector('audio')).not.toBeNull(),
    );
    const other = screen.getByRole('button', { name: 'Khác' });
    other.focus();
    await waitFor(() => expect(container.querySelector('audio')).toBeNull(), {
      timeout: 5_000,
    });
    expect(
      screen.getByText(MEDIA_PREVIEW_MESSAGES.expired),
    ).toBeInTheDocument();
    expect(other).toHaveFocus();
  });

  it('treats an audio error as an expired link', async () => {
    stubGrant(new Date(Date.now() + 600_000).toISOString());
    const { container } = render(<MediaPreview asset={asset()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Nghe thử' }));
    await waitFor(() =>
      expect(container.querySelector('audio')).not.toBeNull(),
    );
    const audio = container.querySelector('audio');
    if (!audio) throw new Error('no audio');
    fireEvent.error(audio);
    expect(
      screen.getByText(MEDIA_PREVIEW_MESSAGES.expired),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Nghe thử' })).toHaveFocus(),
    );
  });
});
