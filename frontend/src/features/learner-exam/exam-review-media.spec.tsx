import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ExamReviewMedia,
  loadReviewGrants,
  resetReviewGrantsCache,
} from './exam-review-media';

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, data }),
  } as Response;
}

afterEach(() => {
  resetReviewGrantsCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ExamReviewMedia (M4.5 B2b)', () => {
  it('dedupes the media-grants call across refs and sets the audio src', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        grants: [
          {
            mediaId: 7,
            kind: 'audio',
            src: '/api/learner/media/7/content?expires=1&signature=x',
            expiresAt: '2026-11-02T10:00:00.000Z',
          },
        ],
        unavailable: [],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <>
        <ExamReviewMedia attemptId={41} mediaId={7} kind="audio" />
        <ExamReviewMedia attemptId={41} mediaId={7} kind="audio" />
      </>,
    );

    await waitFor(() => {
      const audio = document.querySelectorAll('audio');
      expect(audio).toHaveLength(2);
      expect(audio[0]?.getAttribute('src')).toContain('/api/learner/media/7/');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/learner/exam/attempts/41/media-grants',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('shows the unavailable label when the backend lists the media', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ grants: [], unavailable: [7] })),
    );
    render(<ExamReviewMedia attemptId={41} mediaId={7} kind="image" />);
    expect(await screen.findByText('Không tải được hình ảnh.')).toBeVisible();
  });

  it('shows the unavailable label when the BFF fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({ ok: false, status: 503, json: async () => ({}) }) as Response,
      ),
    );
    render(<ExamReviewMedia attemptId={41} mediaId={7} kind="audio" />);
    expect(await screen.findByText('Không tải được âm thanh.')).toBeVisible();
  });

  it('refreshes the grant once after a media load error, then gives up', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        grants: [
          {
            mediaId: 7,
            kind: 'image',
            src: '/api/learner/media/7/content?expires=1&signature=x',
            expiresAt: '2026-11-02T10:00:00.000Z',
          },
        ],
        unavailable: [],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<ExamReviewMedia attemptId={41} mediaId={7} kind="image" />);
    const image = (await screen.findByRole('img')) as HTMLImageElement;
    expect(image.getAttribute('src')).toContain('/api/learner/media/7/');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.error(image);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const refreshed = (await screen.findByRole('img')) as HTMLImageElement;
    fireEvent.error(refreshed);
    await waitFor(() =>
      expect(screen.getByText('Không tải được hình ảnh.')).toBeVisible(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(loadReviewGrants(41)).resolves.toBeTruthy();
  });
});
