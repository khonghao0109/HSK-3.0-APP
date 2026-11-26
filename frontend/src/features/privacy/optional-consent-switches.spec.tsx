import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OptionalConsentSwitches } from './optional-consent-switches';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

afterEach(() => {
  vi.restoreAllMocks();
});

const OFF = { analytics: false, marketing: false };

describe('OptionalConsentSwitches (M1.7b2 B3, Q190)', () => {
  it('shows one labelled, described switch per optional consent, from the backend state', () => {
    render(
      <OptionalConsentSwitches
        initial={{ analytics: true, marketing: false }}
      />,
    );
    const analytics = screen.getByRole('switch', {
      name: 'Phân tích sản phẩm',
    });
    const marketing = screen.getByRole('switch', {
      name: 'Tin tức và ưu đãi',
    });
    expect(analytics).toHaveAttribute('aria-checked', 'true');
    expect(analytics).toBeChecked();
    expect(marketing).toHaveAttribute('aria-checked', 'false');
    expect(marketing).not.toBeChecked();
    expect(analytics).toHaveAccessibleDescription(/cải thiện bài học/u);
    expect(marketing).toHaveAccessibleDescription(/email/u);
    expect(screen.getAllByRole('switch')).toHaveLength(2);
  });

  it('saves a change through the BFF and keeps it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        success: true,
        data: { type: 'analytics', granted: true },
      }),
    );
    render(<OptionalConsentSwitches initial={OFF} />);
    const analytics = screen.getByRole('switch', {
      name: 'Phân tích sản phẩm',
    });
    fireEvent.click(analytics);
    expect(analytics).toHaveAttribute('aria-checked', 'true');
    // Stays focusable while saving (no `disabled`), marked busy instead.
    expect(analytics).toBeEnabled();
    await waitFor(() => expect(analytics).not.toHaveAttribute('aria-busy'));
    expect(analytics).toHaveAttribute('aria-checked', 'true');
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('/api/learner/consents/optional/analytics');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ granted: true });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    [503, 'Chưa lưu được lựa chọn. Thử lại sau ít phút.'],
    [429, 'Bạn đổi lựa chọn quá nhanh. Thử lại sau một phút.'],
  ])(
    'puts the switch back and says why next to it on a %s',
    async (status, message) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        Response.json({ success: false }, { status }),
      );
      render(<OptionalConsentSwitches initial={{ ...OFF, marketing: true }} />);
      const marketing = screen.getByRole('switch', {
        name: 'Tin tức và ưu đãi',
      });
      fireEvent.click(marketing);
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(message);
      expect(marketing).toHaveAttribute('aria-checked', 'true');
      expect(marketing).toBeChecked();
      expect(marketing).toHaveAccessibleDescription(new RegExp(message, 'u'));
    },
  );

  it('puts the switch back when the network fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    render(<OptionalConsentSwitches initial={OFF} />);
    const analytics = screen.getByRole('switch', {
      name: 'Phân tích sản phẩm',
    });
    fireEvent.click(analytics);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Không kết nối được. Kiểm tra mạng rồi thử lại.',
    );
    expect(analytics).toHaveAttribute('aria-checked', 'false');
  });

  it('says so instead of showing guessed switches when the state could not be read', () => {
    render(<OptionalConsentSwitches initial={null} />);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Chưa tải được lựa chọn của bạn. Tải lại trang để thử lại.',
    );
  });

  it('points its description only at an error that exists', () => {
    render(<OptionalConsentSwitches initial={OFF} />);
    for (const input of screen.getAllByRole('switch')) {
      for (const id of (input.getAttribute('aria-describedby') ?? '').split(
        ' ',
      )) {
        expect(document.getElementById(id)).not.toBeNull();
      }
    }
  });

  it('saves the other switch while one is still saving', async () => {
    let finish: (response: Response) => void = () => {};
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => (finish = resolve)),
      )
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          data: { type: 'marketing', granted: true },
        }),
      );
    render(<OptionalConsentSwitches initial={OFF} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Phân tích sản phẩm' }));
    const marketing = screen.getByRole('switch', { name: 'Tin tức và ưu đãi' });
    fireEvent.click(marketing);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(marketing).not.toHaveAttribute('aria-busy'));
    expect(marketing).toHaveAttribute('aria-checked', 'true');
    finish(
      Response.json({
        success: true,
        data: { type: 'analytics', granted: true },
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: 'Phân tích sản phẩm' }),
      ).not.toHaveAttribute('aria-busy'),
    );
  });

  it('sends a learner whose session ended to sign-in', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ success: false }, { status: 401 }),
    );
    router.replace.mockClear();
    render(<OptionalConsentSwitches initial={OFF} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Phân tích sản phẩm' }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/sign-in'),
    );
  });
});
