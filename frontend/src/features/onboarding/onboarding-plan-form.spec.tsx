import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { localDateString } from './onboarding-contract';
import { ONBOARDING_ERROR_MESSAGES } from './onboarding-messages';
import { OnboardingPlanForm } from './onboarding-plan-form';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

describe('OnboardingPlanForm', () => {
  beforeEach(() => {
    replace.mockReset();
    vi.restoreAllMocks();
  });

  it('updates tip text dynamically when changing daily minutes', async () => {
    const user = userEvent.setup();
    render(
      <OnboardingPlanForm
        purpose="communication"
        band={3}
        initialDailyMinutes={15}
        initialReminderEnabled={true}
        initialReminderTime="19:00"
      />,
    );

    // Initial tip for 15 minutes
    expect(
      screen.getByText(/Học 15 phút mỗi ngày giúp bạn nhớ lâu hơn/),
    ).toBeInTheDocument();

    // Select 10 minutes
    const min10Radio = screen.getByRole('radio', { name: /10/ });
    await user.click(min10Radio);
    expect(
      screen.getByText(/Học 10 phút mỗi ngày là khởi đầu nhẹ nhàng/),
    ).toBeInTheDocument();

    // Select 30 minutes
    const min30Radio = screen.getByRole('radio', { name: /30/ });
    await user.click(min30Radio);
    expect(
      screen.getByText(/Học 30 phút mỗi ngày giúp bạn tăng tốc/),
    ).toBeInTheDocument();
  });

  it('submits reminderTime: null when switch is toggled off and uses local startDate', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ success: true }, { status: 200 }));

    render(
      <OnboardingPlanForm
        purpose="communication"
        band={3}
        initialDailyMinutes={15}
        initialReminderEnabled={true}
        initialReminderTime="19:00"
      />,
    );

    // Toggle reminder switch off
    const switchInput = screen.getByRole('switch', {
      name: /Nhận nhắc nhở học tập/i,
    });
    expect(switchInput).toBeChecked();
    await user.click(switchInput);
    expect(switchInput).not.toBeChecked();

    const submitBtn = screen.getByRole('button', { name: 'Tiếp tục' });
    await user.click(submitBtn);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstCall = fetchSpy.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [, init] = firstCall!;
    const sentBody = JSON.parse(init?.body as string);

    expect(sentBody).toEqual({
      learningPurpose: 'communication',
      targetBand: 3,
      dailyMinutes: 15,
      reminderEnabled: false,
      reminderTime: null,
      startDate: localDateString(new Date()),
    });

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/learn');
    });
  });

  it('prevents double submit on double click and calls fetch only once', async () => {
    let resolveFetch: (val: Response) => void;
    const pendingPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockReturnValue(pendingPromise);

    render(
      <OnboardingPlanForm
        purpose="communication"
        band={3}
        initialDailyMinutes={15}
        initialReminderEnabled={true}
        initialReminderTime="19:00"
      />,
    );

    const submitBtn = screen.getByRole('button', { name: 'Tiếp tục' });
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveAttribute('aria-busy', 'true');
    expect(submitBtn).toHaveTextContent('Đang lưu…');

    resolveFetch!(Response.json({ success: true }, { status: 200 }));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/learn');
    });
  });

  it('handles content_unavailable error with error message and link to select another level', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { success: false, error: { kind: 'content_unavailable' } },
        { status: 409 },
      ),
    );

    render(
      <OnboardingPlanForm
        purpose="communication"
        band={2}
        initialDailyMinutes={15}
        initialReminderEnabled={true}
        initialReminderTime="19:00"
      />,
    );

    const submitBtn = screen.getByRole('button', { name: 'Tiếp tục' });
    await user.click(submitBtn);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      ONBOARDING_ERROR_MESSAGES.contentUnavailable,
    );
    const changeLink = screen.getByRole('link', {
      name: ONBOARDING_ERROR_MESSAGES.changeLevelLinkText,
    });
    expect(changeLink).toHaveAttribute(
      'href',
      '/onboarding/goal?purpose=communication&band=2&notice=content_unavailable',
    );
  });

  it('handles level_unavailable error with error message and link to select another level', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { success: false, error: { kind: 'level_unavailable' } },
        { status: 409 },
      ),
    );

    render(
      <OnboardingPlanForm
        purpose="work"
        band={5}
        initialDailyMinutes={10}
        initialReminderEnabled={true}
        initialReminderTime="19:00"
      />,
    );

    const submitBtn = screen.getByRole('button', { name: 'Tiếp tục' });
    await user.click(submitBtn);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(ONBOARDING_ERROR_MESSAGES.levelUnavailable);
    const changeLink = screen.getByRole('link', {
      name: ONBOARDING_ERROR_MESSAGES.changeLevelLinkText,
    });
    expect(changeLink).toHaveAttribute(
      'href',
      '/onboarding/goal?purpose=work&band=5',
    );
  });

  it('links level_unavailable to the goal page without notice while content_unavailable keeps notice', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json(
          { success: false, error: { kind: 'level_unavailable' } },
          { status: 409 },
        ),
      );

    const { unmount } = render(
      <OnboardingPlanForm
        purpose="hsk_exam"
        band={7}
        initialDailyMinutes={15}
        initialReminderEnabled={true}
        initialReminderTime="19:00"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    const levelLink = screen.getByRole('link', {
      name: ONBOARDING_ERROR_MESSAGES.changeLevelLinkText,
    });
    expect(levelLink.getAttribute('href')).toBe(
      '/onboarding/goal?purpose=hsk_exam&band=7',
    );
    expect(levelLink.getAttribute('href')).not.toContain('notice');
    unmount();

    fetchSpy.mockResolvedValue(
      Response.json(
        { success: false, error: { kind: 'content_unavailable' } },
        { status: 409 },
      ),
    );
    render(
      <OnboardingPlanForm
        purpose="hsk_exam"
        band={7}
        initialDailyMinutes={15}
        initialReminderEnabled={true}
        initialReminderTime="19:00"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    const contentLink = screen.getByRole('link', {
      name: ONBOARDING_ERROR_MESSAGES.changeLevelLinkText,
    });
    expect(contentLink.getAttribute('href')).toBe(
      '/onboarding/goal?purpose=hsk_exam&band=7&notice=content_unavailable',
    );
  });

  it('shows the generic error message when the BFF responds 503', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { success: false, error: { kind: 'upstream_unavailable' } },
        { status: 503 },
      ),
    );

    render(
      <OnboardingPlanForm
        purpose="communication"
        band={3}
        initialDailyMinutes={15}
        initialReminderEnabled={true}
        initialReminderTime="19:00"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Tiếp tục' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(ONBOARDING_ERROR_MESSAGES.generic);
    expect(replace).not.toHaveBeenCalled();
  });

  it('submits the selected reminderTime with reminderEnabled true when reminder is on', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ success: true }, { status: 200 }));

    render(
      <OnboardingPlanForm
        purpose="communication"
        band={3}
        initialDailyMinutes={15}
        initialReminderEnabled={true}
        initialReminderTime="19:00"
      />,
    );

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Giờ học mỗi ngày' }),
      '07:00',
    );
    await user.click(screen.getByRole('button', { name: 'Tiếp tục' }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0]!;
    const sentBody = JSON.parse(init?.body as string);
    expect(sentBody.reminderEnabled).toBe(true);
    expect(sentBody.reminderTime).toBe('07:00');
  });

  it('posts JSON to the onboarding complete BFF route with the local startDate', async () => {
    // Pin a UTC+7 zone so local midnight differs from the UTC date even on
    // UTC CI runners; otherwise a toISOString() regression would pass.
    const previousTz = process.env.TZ;
    process.env.TZ = 'Asia/Ho_Chi_Minh';
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 9, 5, 0, 30));
      expect(new Date().toISOString().slice(0, 10)).not.toBe('2026-10-05');
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(Response.json({ success: true }, { status: 200 }));

      render(
        <OnboardingPlanForm
          purpose="communication"
          band={3}
          initialDailyMinutes={15}
          initialReminderEnabled={true}
          initialReminderTime="19:00"
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(url).toBe('/api/learner/onboarding/complete');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('content-type')).toBe(
        'application/json',
      );
      const sentBody = JSON.parse(init?.body as string);
      expect(sentBody.startDate).toBe('2026-10-05');
    } finally {
      vi.useRealTimers();
      if (previousTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTz;
      }
    }
  });

  it('handles conflict error with conflict message', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { success: false, error: { kind: 'conflict' } },
        { status: 409 },
      ),
    );

    render(
      <OnboardingPlanForm
        purpose="communication"
        band={3}
        initialDailyMinutes={15}
        initialReminderEnabled={true}
        initialReminderTime="19:00"
      />,
    );

    const submitBtn = screen.getByRole('button', { name: 'Tiếp tục' });
    await user.click(submitBtn);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(ONBOARDING_ERROR_MESSAGES.conflict);
  });

  it('redirects to /sign-in on 401 error', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { success: false, error: { kind: 'session_expired' } },
        { status: 401 },
      ),
    );

    render(
      <OnboardingPlanForm
        purpose="communication"
        band={3}
        initialDailyMinutes={15}
        initialReminderEnabled={true}
        initialReminderTime="19:00"
      />,
    );

    const submitBtn = screen.getByRole('button', { name: 'Tiếp tục' });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/sign-in');
    });
  });

  it('handles rate limited 429 and network error', async () => {
    const user = userEvent.setup();
    // 1. Rate limited
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json(
          { success: false, error: { kind: 'rate_limited' } },
          { status: 429 },
        ),
      );

    const { unmount } = render(
      <OnboardingPlanForm
        purpose="communication"
        band={3}
        initialDailyMinutes={15}
        initialReminderEnabled={true}
        initialReminderTime="19:00"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      ONBOARDING_ERROR_MESSAGES.rateLimited,
    );
    unmount();

    // 2. Network error
    fetchSpy.mockRejectedValue(new Error('Network error'));
    render(
      <OnboardingPlanForm
        purpose="communication"
        band={3}
        initialDailyMinutes={15}
        initialReminderEnabled={true}
        initialReminderTime="19:00"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      ONBOARDING_ERROR_MESSAGES.network,
    );
  });
});
