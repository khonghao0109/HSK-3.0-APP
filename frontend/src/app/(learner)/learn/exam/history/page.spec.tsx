import { cleanup, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import { getExamHistory } from '@/features/learner-exam/exam-history-service';
import type { ExamHistoryPage } from '@/features/learner-exam/exam-history-service';
import { getPublicLevels } from '@/features/onboarding/onboarding-service';
import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';
import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';

import LearnerExamHistoryPage, { metadata } from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock('@/features/learner-auth/server-learner-session', () => ({
  getServerLearnerSession: vi.fn(),
}));
vi.mock('@/features/learner-exam/exam-history-service', () => ({
  getExamHistory: vi.fn(),
}));
vi.mock('@/features/onboarding/onboarding-service', () => ({
  getPublicLevels: vi.fn(),
  getCurrentGoal: vi.fn(),
}));

const LEVELS = [
  { id: 3, name: 'HSK 3', orderIndex: 3, code: 'HSK3', minBand: 3, maxBand: 3 },
  { id: 4, name: 'HSK 4', orderIndex: 4, code: 'HSK4', minBand: 4, maxBand: 4 },
];

const GRADED: ExamHistoryPage['data'][number] = {
  attemptId: 9,
  testId: 3,
  testTitle: 'HSK 3 – Đề 04',
  levelCode: 'HSK3',
  status: 'submitted',
  finishedAt: '2026-05-19T03:00:00.000Z',
  score: 248,
  maxScore: 300,
  passScore: 180,
  passed: true,
  skills: [{ skill: 'listening', score: 86, maxScore: 100 }],
};

function page(
  data: ExamHistoryPage['data'],
  meta: Partial<ExamHistoryPage['meta']> = {},
): ExamHistoryPage {
  return {
    success: true,
    data,
    meta: {
      page: 1,
      limit: 20,
      total: data.length,
      totalPages: data.length === 0 ? 0 : 1,
      ...meta,
    },
  };
}

async function show(query: Record<string, string> = {}): Promise<void> {
  render(
    <LearnerToastProvider>
      {await LearnerExamHistoryPage({ searchParams: Promise.resolve(query) })}
    </LearnerToastProvider>,
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.mocked(getServerLearnerSession).mockResolvedValue({
    state: 'learner',
    token: 'tok',
  } as Awaited<ReturnType<typeof getServerLearnerSession>>);
  vi.mocked(getPublicLevels).mockResolvedValue(LEVELS);
});

describe('LearnerExamHistoryPage', () => {
  it('has its own title', () => {
    expect(metadata.title).toBe('Lịch sử thi');
  });

  it('renders a captioned table linking to the result', async () => {
    vi.mocked(getExamHistory).mockResolvedValue(page([GRADED]));
    await show();

    const table = screen.getByRole('table', { name: 'Lịch sử thi thử' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headers).toEqual([
      'Ngày',
      'Đề thi',
      'Điểm tổng',
      'Nghe',
      'Đọc',
      'Viết',
      'Trạng thái',
    ]);
    expect(
      within(table).getByRole('link', { name: 'HSK 3 – Đề 04' }),
    ).toHaveAttribute('href', '/learn/exam/attempts/9/result');
    expect(within(table).getByText('Đạt')).toBeInTheDocument();
    expect(
      screen.getByText('Điểm đạt HSK 3 là từ 180/300.'),
    ).toBeInTheDocument();
  });

  it('offers every level and resets to page 1 when filtering', async () => {
    vi.mocked(getExamHistory).mockResolvedValue(
      page([GRADED], { page: 2, total: 21, totalPages: 2 }),
    );
    await show({ levelCode: 'HSK3', page: '2' });

    const chips = screen.getByRole('group', {
      name: 'Lọc lịch sử thi theo cấp HSK',
    });
    expect(within(chips).getByRole('link', { name: 'Tất cả' })).toHaveAttribute(
      'href',
      '/learn/exam/history',
    );
    expect(within(chips).getByRole('link', { name: 'HSK 4' })).toHaveAttribute(
      'href',
      '/learn/exam/history?levelCode=HSK4',
    );
    expect(within(chips).getByRole('link', { name: 'HSK 3' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(getExamHistory).toHaveBeenCalledWith(
      { levelCode: 'HSK3', page: 2 },
      'tok',
    );
    expect(screen.getByRole('link', { name: 'Trang trước' })).toHaveAttribute(
      'href',
      '/learn/exam/history?levelCode=HSK3',
    );
  });

  it('ignores a level the app does not offer', async () => {
    vi.mocked(getExamHistory).mockResolvedValue(page([]));
    await show({ levelCode: 'HSK9' });
    expect(getExamHistory).toHaveBeenCalledWith(
      { levelCode: null, page: 1 },
      'tok',
    );
  });

  it('shows the first-use empty state', async () => {
    vi.mocked(getExamHistory).mockResolvedValue(page([]));
    await show();
    expect(screen.getByText('Chưa có lần thi nào')).toBeInTheDocument();
    const empty = screen.getByTestId('exam-history-empty');
    expect(
      within(empty).getByRole('link', { name: 'Chọn đề thi' }),
    ).toHaveAttribute('href', '/learn/exam');
  });

  it('offers a way back to all levels when a filter is empty', async () => {
    vi.mocked(getExamHistory).mockResolvedValue(page([]));
    await show({ levelCode: 'HSK4' });
    const empty = screen.getByTestId('exam-history-empty');
    expect(
      within(empty).getByRole('link', { name: 'Xem tất cả' }),
    ).toHaveAttribute('href', '/learn/exam/history');
  });

  it('returns to page 1 when the requested page is past the end', async () => {
    vi.mocked(getExamHistory).mockResolvedValue(page([], { page: 9 }));
    await expect(show({ page: '9' })).rejects.toThrow(
      'NEXT_REDIRECT:/learn/exam/history',
    );
  });

  it('shows a retry that keeps the filter on a backend failure', async () => {
    vi.mocked(getExamHistory).mockRejectedValue(new Error('boom'));
    await show({ levelCode: 'HSK3' });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Thử lại' })).toHaveAttribute(
      'href',
      '/learn/exam/history?levelCode=HSK3',
    );
  });

  it('sends an expired session to sign-in', async () => {
    vi.mocked(getExamHistory).mockRejectedValue(
      new BackendRequestError(normalizeApiFailure({ status: 401 })),
    );
    await expect(show()).rejects.toThrow('NEXT_REDIRECT:/sign-in');
  });
});
