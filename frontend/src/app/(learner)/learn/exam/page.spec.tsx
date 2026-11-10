import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';
import { getExamTestList } from '@/features/learner-exam/exam-list-service';
import type {
  ExamListPage,
  ExamTestListItem,
} from '@/features/learner-exam/exam-list-service';
import {
  getCurrentGoal,
  getPublicLevels,
} from '@/features/onboarding/onboarding-service';
import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';

import LearnerExamListPage, { metadata } from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock('@/features/learner-auth/server-learner-session', () => ({
  getServerLearnerSession: vi.fn(),
}));
vi.mock('@/features/learner-exam/exam-list-service', () => ({
  getExamTestList: vi.fn(),
}));
vi.mock('@/features/onboarding/onboarding-service', () => ({
  getPublicLevels: vi.fn(),
  getCurrentGoal: vi.fn(),
}));

const LEVELS = [
  {
    id: 1,
    name: 'HSK 1',
    orderIndex: 1,
    code: 'HSK1',
    minBand: 1,
    maxBand: 1,
  },
  {
    id: 2,
    name: 'HSK 2',
    orderIndex: 2,
    code: 'HSK2',
    minBand: 2,
    maxBand: 2,
  },
  {
    id: 3,
    name: 'HSK 3',
    orderIndex: 3,
    code: 'HSK3',
    minBand: 3,
    maxBand: 3,
  },
];

const GOAL = {
  id: 1,
  targetLevelId: 3,
  targetBand: 3,
  dailyMinutes: 30,
  learningPurpose: null,
  reminderEnabled: false,
  reminderTime: null,
  startDate: '2026-10-01',
  isActive: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  targetLevel: {
    id: 3,
    code: 'HSK3',
    name: 'HSK 3',
    minBand: 3,
    maxBand: 3,
  },
};

function doneItem(): ExamTestListItem {
  return {
    testId: 11,
    title: 'Đề 01',
    levelCode: 'HSK3',
    duration: 90,
    questionCount: 40,
    skills: ['listening', 'reading'],
    status: 'done',
    activeAttempt: null,
    latestAttempt: {
      attemptId: 501,
      status: 'submitted',
      score: 180,
      maxScore: 200,
      submittedAt: '2026-10-20T02:00:00.000Z',
      resultAvailable: true,
    },
  };
}

function activeItem(): ExamTestListItem {
  return {
    testId: 12,
    title: 'Đề 02',
    levelCode: 'HSK3',
    duration: 80,
    questionCount: 30,
    skills: ['reading'],
    status: 'in_progress',
    activeAttempt: {
      attemptId: 77,
      expiresAt: '2026-10-27T03:20:00.000Z',
    },
    latestAttempt: null,
  };
}

function ungradedItem(): ExamTestListItem {
  return {
    testId: 13,
    title: 'Đề 03',
    levelCode: 'HSK3',
    duration: 90,
    questionCount: 10,
    skills: ['writing'],
    status: 'done',
    activeAttempt: null,
    latestAttempt: {
      attemptId: 502,
      status: 'timed_out',
      score: null,
      maxScore: null,
      submittedAt: '2026-10-21T02:00:00.000Z',
      resultAvailable: false,
    },
  };
}

function notStartedItem(): ExamTestListItem {
  return {
    testId: 14,
    title: 'Đề 04',
    levelCode: 'HSK3',
    duration: 80,
    questionCount: 20,
    skills: ['listening'],
    status: 'not_started',
    activeAttempt: null,
    latestAttempt: null,
  };
}

const ALL_ITEMS = [doneItem(), activeItem(), ungradedItem(), notStartedItem()];

function pageOf(
  items: ExamTestListItem[],
  overrides: Partial<ExamListPage['meta']> = {},
): ExamListPage {
  return {
    success: true,
    data: items,
    meta: {
      page: 1,
      limit: 20,
      total: items.length,
      totalPages: 1,
      ...overrides,
    },
  };
}

/**
 * The page makes two fixed reads: the skill facet (limit 100) and the visible
 * page (limit 20). The mock filters the second one by `skill` like the backend.
 */
function mockList(items: ExamTestListItem[] = ALL_ITEMS): void {
  vi.mocked(getExamTestList).mockImplementation((query) => {
    if (query.limit === 100) return Promise.resolve(pageOf(items));
    const skill = query.skill;
    const filtered =
      skill === undefined
        ? items
        : items.filter((item) => item.skills.includes(skill));
    return Promise.resolve(pageOf(filtered));
  });
}

async function renderPage(
  params: Record<string, string> = {},
): Promise<ReturnType<typeof render>> {
  return render(
    <LearnerToastProvider>
      {await LearnerExamListPage({ searchParams: Promise.resolve(params) })}
    </LearnerToastProvider>,
  );
}

describe('LearnerExamListPage', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'learner',
      token: 'learner-token',
      user: { id: 1, email: 'learner@example.test', role: 'user' },
    });
    vi.mocked(getPublicLevels).mockResolvedValue(LEVELS);
    vi.mocked(getCurrentGoal).mockResolvedValue(GOAL);
    mockList();
  });

  it('keeps the documented page title', () => {
    expect(metadata.title).toBe('Thi thử HSK');
  });

  it('redirects to sign-in without a learner session', async () => {
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'unauthenticated',
      token: null,
    });
    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/sign-in');
  });

  it.each([401, 403])(
    'redirects to sign-in when the backend answers %s',
    async (status) => {
      vi.mocked(getExamTestList).mockRejectedValue(
        new BackendRequestError(normalizeApiFailure({ status })),
      );
      await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/sign-in');
    },
  );

  it("defaults the level chip to the learner's current level (Q209)", async () => {
    await renderPage();
    const group = screen.getByRole('group', {
      name: /Chọn cấp độ HSK|Cấp độ/u,
    });
    const current = within(group)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'true');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('HSK 3');
    // The level is in the URL of every chip link, so the filter is shareable.
    expect(within(group).getByRole('link', { name: 'HSK 2' })).toHaveAttribute(
      'href',
      '/learn/exam?levelCode=HSK2',
    );
  });

  it('falls back to HSK 1 when the learner has no goal yet (Q209)', async () => {
    vi.mocked(getCurrentGoal).mockResolvedValue(null);
    await renderPage();
    const group = screen.getByRole('group', {
      name: /Chọn cấp độ HSK|Cấp độ/u,
    });
    expect(
      within(group)
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'true')[0],
    ).toHaveTextContent('HSK 1');
  });

  it('lets the URL level win over the default', async () => {
    await renderPage({ levelCode: 'HSK2' });
    expect(getExamTestList).toHaveBeenCalledWith(
      expect.objectContaining({ levelCode: 'HSK2' }),
      'learner-token',
    );
  });

  it('ignores an unknown level in the URL and keeps the default', async () => {
    await renderPage({ levelCode: 'HSK9' });
    expect(getExamTestList).toHaveBeenCalledWith(
      expect.objectContaining({ levelCode: 'HSK3' }),
      'learner-token',
    );
  });

  it('shows only the skill chips with at least one test at the level (Q210)', async () => {
    await renderPage();
    const group = screen.getByRole('group', { name: /Chọn kỹ năng|Kỹ năng/u });
    expect(
      within(group)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Tất cả', 'Nghe', 'Đọc', 'Viết']);
    expect(within(group).queryByRole('link', { name: 'Nói' })).toBeNull();
  });

  it('marks the selected skill and keeps it in the links (Q210)', async () => {
    await renderPage({ levelCode: 'HSK3', skill: 'reading' });
    const group = screen.getByRole('group', { name: /Chọn kỹ năng|Kỹ năng/u });
    const reading = within(group).getByRole('link', { name: 'Đọc' });
    expect(reading).toHaveAttribute('aria-current', 'true');
    expect(group.querySelectorAll('[aria-current]')).toHaveLength(1);
    expect(within(group).getByRole('link', { name: 'Tất cả' })).toHaveAttribute(
      'href',
      '/learn/exam?levelCode=HSK3',
    );
  });

  it('renders exam cards with status, score and links (Q212/Q214)', async () => {
    await renderPage();
    const list = screen.getByRole('list', { name: 'Danh sách đề thi' });
    const cards = within(list).getAllByRole('link');
    expect(cards).toHaveLength(4);

    // U1: a finished attempt opens the result page (mockup exams.html).
    expect(cards[0]).toHaveAttribute('href', '/learn/exam/attempts/501/result');
    expect(cards[0]).toHaveTextContent('Đã làm');
    expect(cards[0]).toHaveTextContent('180/200');
    expect(cards[0]).toHaveTextContent('Nghe, Đọc');
    expect(cards[0]).toHaveTextContent('40 câu');
    expect(cards[0]).toHaveTextContent('90 phút');

    // Q212: an active attempt links straight to the take screen.
    expect(cards[1]).toHaveAttribute('href', '/learn/exam/attempts/77');
    expect(cards[1]).toHaveTextContent('Đang làm');
    expect(cards[1]).toHaveTextContent('Làm tiếp');

    // Q214: finished but not graded still opens the result page (it grades
    // lazily there); the card itself shows no score.
    expect(cards[2]).toHaveAttribute('href', '/learn/exam/attempts/502/result');
    expect(cards[2]).toHaveTextContent('Chưa có điểm');
    expect(cards[2]).not.toHaveTextContent('180');

    expect(cards[3]).toHaveAttribute('href', '/learn/exam/14');
    expect(cards[3]).toHaveTextContent('Chưa làm');
    expect(cards[3]).toHaveTextContent('Bắt đầu thi');
    // U2: the jade card border selector needs this class on the rendered link;
    // `done` cards must not carry it.
    expect(cards[3]).toHaveClass(/exl-item--not_started/u);
    expect(cards[0]).not.toHaveClass(/exl-item--not_started/u);
  });

  it('links the three sort orders through searchParams (Q211)', async () => {
    const { container } = await renderPage({
      levelCode: 'HSK3',
      sort: 'score',
    });
    expect(screen.getAllByText('Điểm cao').length).toBeGreaterThanOrEqual(1);
    const options = Array.from(container.querySelectorAll('.exl-sort__menu a'));
    expect(options.map((link) => link.getAttribute('href'))).toEqual([
      '/learn/exam?levelCode=HSK3',
      '/learn/exam?levelCode=HSK3&sort=oldest',
      '/learn/exam?levelCode=HSK3&sort=score',
    ]);
    expect(options[2]).toHaveAttribute('aria-current', 'true');
  });

  it('renders the count of matching tests', async () => {
    await renderPage();
    expect(screen.getByTestId('exam-list-count')).toHaveTextContent(
      '4 đề phù hợp',
    );
  });

  it('renders the empty state with a link to every level', async () => {
    mockList([]);
    await renderPage({ levelCode: 'HSK3' });
    const empty = screen.getByTestId('exam-list-empty');
    expect(empty).toHaveTextContent('Chưa có đề ở cấp này');
    expect(
      within(empty).getByRole('link', { name: 'Xem tất cả đề' }),
    ).toHaveAttribute('href', '/learn/exam');
  });

  it('renders a retryable error state that keeps the filters', async () => {
    vi.mocked(getExamTestList).mockRejectedValue(
      new BackendRequestError(normalizeApiFailure({ status: 500 })),
    );
    await renderPage({
      levelCode: 'HSK2',
      skill: 'reading',
      sort: 'oldest',
      page: '2',
    });
    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent('Chưa tải được danh sách đề');
    expect(
      within(error).getByRole('link', { name: 'Thử lại' }),
    ).toHaveAttribute(
      'href',
      '/learn/exam?levelCode=HSK2&skill=reading&sort=oldest&page=2',
    );
  });

  it('paginates only when there is more than one page', async () => {
    vi.mocked(getExamTestList).mockImplementation((query) =>
      Promise.resolve(
        pageOf(ALL_ITEMS, {
          page: query.limit === 100 ? 1 : query.page,
          total: 25,
          totalPages: 2,
        }),
      ),
    );
    await renderPage({ levelCode: 'HSK3' });
    const pager = screen.getByRole('navigation', {
      name: 'Phân trang danh sách đề',
    });
    expect(within(pager).getByText('Trang 1/2')).toBeDefined();
    expect(
      within(pager).getByRole('link', { name: 'Trang sau' }),
    ).toHaveAttribute('href', '/learn/exam?levelCode=HSK3&page=2');
    expect(
      within(pager).queryByRole('link', { name: 'Trang trước' }),
    ).toBeNull();
  });

  it('links to the exam history', async () => {
    await renderPage();
    expect(screen.getByRole('link', { name: /Lịch sử thi/u })).toHaveAttribute(
      'href',
      '/learn/exam/history',
    );
  });

  it('shows the highest finished score in the trophy toast (Q226)', async () => {
    mockList([
      doneItem(),
      {
        ...doneItem(),
        testId: 15,
        title: 'Đề 05',
        latestAttempt: {
          attemptId: 503,
          status: 'submitted',
          score: 199,
          maxScore: 200,
          submittedAt: '2026-10-22T02:00:00.000Z',
          resultAvailable: true,
        },
      },
      ungradedItem(),
    ]);
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Thành tích thi thử' }));
    expect(screen.getByText('Điểm cao nhất: 199/200 — Đề 05')).toBeDefined();
  });

  it('falls back to "Chưa có điểm thi thử" in the trophy toast (Q226)', async () => {
    mockList([activeItem(), notStartedItem()]);
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Thành tích thi thử' }));
    expect(screen.getByText('Chưa có điểm thi thử')).toBeDefined();
  });

  it('renders the mobile bar and the web page heading', async () => {
    await renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Thi thử' }),
    ).toBeDefined();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Thi thử HSK' }),
    ).toBeDefined();
    expect(
      screen.getByRole('link', { name: 'Quay lại Trang chủ' }),
    ).toHaveAttribute('href', '/learn');
    // B1 has no achievements API: the trophy is a "coming soon" toast, never a
    // dead link.
    expect(
      screen.getByRole('button', { name: 'Thành tích thi thử' }),
    ).toBeDefined();
  });
});
