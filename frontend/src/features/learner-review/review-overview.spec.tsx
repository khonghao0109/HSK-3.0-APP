import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReviewOverviewView } from './review-overview';
import type { ReviewOverview } from './review-overview-model';
import type { ReviewCall } from './review-transport';

const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const calendar = Array.from({ length: 30 }, (_, i) => ({
  date: `2026-11-${String(i + 1).padStart(2, '0')}`,
  reviewed: i + 1 === 12 ? 15 : i + 1 === 3 ? 45 : 0,
}));

const overview: ReviewOverview = {
  dueToday: 20,
  upcoming: { days3: 4, days7: 9, days14: 15 },
  retention7d: 87,
  calendar,
  recentSessions: [
    {
      sessionId: 41,
      completedAt: '2026-11-12T08:12:00.000Z',
      reviewedCount: 20,
      retentionPercent: 85,
    },
    {
      sessionId: 40,
      completedAt: '2026-11-11T08:12:00.000Z',
      reviewedCount: 3,
      retentionPercent: null,
    },
  ],
};

function transport(result: ReviewCall<ReviewOverview>) {
  return {
    current: vi.fn(),
    create: vi.fn(),
    grade: vi.fn(),
    complete: vi.fn(),
    overview: vi.fn().mockResolvedValue(result),
  };
}

const view = (t: ReturnType<typeof transport>) =>
  render(<ReviewOverviewView transport={t as never} />);

afterEach(() => {
  router.replace.mockReset();
});

describe('ReviewOverviewView (M3.3b, Q270)', () => {
  it('shows due today with Ôn ngay links to the session', async () => {
    view(transport({ ok: true, data: overview }));
    const due = await screen.findByRole('link', {
      name: 'Đến hạn hôm nay: 20 thẻ. Bắt đầu ôn',
    });
    expect(due).toHaveAttribute('href', '/learn/review/session');
    expect(
      screen.getByRole('link', { name: /Bắt đầu ôn ngay/ }),
    ).toHaveAttribute('href', '/learn/review/session');
  });

  it('shows the 7-day retention, the 3/7/14-day split and no streak (Q269)', async () => {
    view(transport({ ok: true, data: overview }));
    expect(
      await screen.findByLabelText('Tỷ lệ ghi nhớ 87 phần trăm'),
    ).toBeInTheDocument();
    const split = screen
      .getByRole('heading', { name: 'Sắp đến hạn' })
      .closest('section') as HTMLElement;
    expect(within(split).getByText('3 ngày tới').nextSibling).toHaveTextContent(
      '4 thẻ',
    );
    expect(within(split).getByText('7 ngày tới').nextSibling).toHaveTextContent(
      '9 thẻ',
    );
    expect(
      within(split).getByText('14 ngày tới').nextSibling,
    ).toHaveTextContent('15 thẻ');
    expect(screen.queryByText(/Chuỗi ngày/)).not.toBeInTheDocument();
  });

  it('draws the month calendar shaded by reviewed cards', async () => {
    view(transport({ ok: true, data: overview }));
    const table = await screen.findByRole('table', {
      name: 'Số thẻ đã ôn theo ngày, Tháng 11, 2026',
    });
    expect(
      within(table).getByText('12 tháng 11: ôn 11–20 thẻ'),
    ).toBeInTheDocument();
    expect(
      within(table).getByText('12 tháng 11: ôn 11–20 thẻ').closest('td'),
    ).toHaveAttribute('data-l', '2');
    expect(
      within(table).getByText('3 tháng 11: ôn trên 40 thẻ').closest('td'),
    ).toHaveAttribute('data-l', '5');
    expect(
      within(table).getByText('1 tháng 11: không ôn').closest('td'),
    ).not.toHaveAttribute('data-l');
    expect(screen.queryByRole('button', { name: 'Tháng trước' })).toBeNull();
  });

  it('lists the recent sessions without a Xem tất cả link', async () => {
    view(transport({ ok: true, data: overview }));
    const table = await screen.findByRole('table', { name: 'Lịch sử ôn tập' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('20 thẻ');
    expect(rows[0]).toHaveTextContent('85%');
    expect(rows[1]).toHaveTextContent('—');
    expect(screen.queryByText('Xem tất cả')).not.toBeInTheDocument();
  });

  it('disables Ôn ngay and says why when nothing is due, — without retention', async () => {
    view(
      transport({
        ok: true,
        data: {
          ...overview,
          dueToday: 0,
          retention7d: null,
          recentSessions: [],
        },
      }),
    );
    expect(await screen.findAllByText('Không có thẻ đến hạn')).not.toHaveLength(
      0,
    );
    expect(
      screen.queryByRole('link', { name: /Bắt đầu ôn/ }),
    ).not.toBeInTheDocument();
    for (const button of screen.getAllByRole('button', {
      name: /Ôn ngay|Bắt đầu ôn ngay/,
    })) {
      expect(button).toBeDisabled();
    }
    expect(
      screen.getByLabelText('Tỷ lệ ghi nhớ: chưa có dữ liệu'),
    ).toHaveTextContent('—');
    expect(
      screen.getByText('Chưa có phiên ôn nào trong 30 ngày qua.'),
    ).toBeInTheDocument();
  });

  it('retries after a failure and sends an unauthorised learner to sign-in', async () => {
    const t = transport({ ok: false, status: 503, code: null });
    view(t);
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    expect(t.overview).toHaveBeenCalledTimes(2);

    view(transport({ ok: false, status: 401, code: null }));
    await vi.waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/sign-in'),
    );
  });
});
