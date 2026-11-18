import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LessonImage } from './lesson-image';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LessonImage (Q350)', () => {
  it('loads the learner grant and renders the image with its Vietnamese alt', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        data: { src: '/api/learner/media/7/content?expires=1&signature=x' },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<LessonImage mediaId={7} altText="Cô giáo đứng cạnh bảng" />);
    const image = await screen.findByRole('img', {
      name: 'Cô giáo đứng cạnh bảng',
    });
    expect(image.getAttribute('src')).toBe(
      '/api/learner/media/7/content?expires=1&signature=x',
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/learner/media/7/access');
  });

  it('renders nothing when the grant is refused or points elsewhere', async () => {
    for (const response of [
      { ok: false, json: async () => ({}) },
      {
        ok: true,
        json: async () => ({ data: { src: 'https://evil.example/x.png' } }),
      },
    ]) {
      const fetchMock = vi.fn(async () => response);
      vi.stubGlobal('fetch', fetchMock);
      const { container, unmount } = render(
        <LessonImage mediaId={7} altText="x" />,
      );
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(container.querySelector('img')).toBeNull();
      unmount();
    }
  });
});
