import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WORD_AUDIO_FAILED,
  WORD_AUDIO_LABEL,
  WordAudioButton,
} from './word-audio-button';

const SIG = 'ab'.repeat(32);
const grant = (mediaId: number) =>
  Response.json({
    success: true,
    data: {
      src: `/api/learner/media/${mediaId}/content?expires=9&signature=${SIG}`,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    },
  });

describe('WordAudioButton (M2.13c2)', () => {
  let play: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing without audio', () => {
    const { container } = render(<WordAudioButton audio={null} hanzi="好" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is a labelled button that fetches a grant only when pressed, then plays', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(grant(31)));
    render(<WordAudioButton audio={{ mediaId: 31 }} hanzi="好" />);
    const button = screen.getByRole('button', {
      name: `${WORD_AUDIO_LABEL} 好`,
    });
    expect(button).toHaveAttribute('type', 'button');
    expect(fetchSpy).not.toHaveBeenCalled();
    await userEvent.setup().click(button);
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(fetchSpy).toHaveBeenCalledWith('/api/learner/media/31/access');
    expect(document.querySelector('audio')?.getAttribute('src')).toBe(
      `/api/learner/media/31/content?expires=9&signature=${SIG}`,
    );
  });

  it('plays from the keyboard', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(grant(31)),
    );
    render(<WordAudioButton audio={{ mediaId: 31 }} hanzi="好" />);
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
  });

  it('announces a failure and never plays a foreign src', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(grant(99)),
    );
    render(<WordAudioButton audio={{ mediaId: 31 }} hanzi="好" />);
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();
    await userEvent.setup().click(screen.getByRole('button'));
    const message = await within(status).findByText(WORD_AUDIO_FAILED);
    expect(message).toHaveClass('ex-error');
    expect(message.closest('.sr-only')).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });
});
