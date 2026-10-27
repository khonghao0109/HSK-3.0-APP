import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notFound, redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';
import { getExamIntro } from '@/features/learner-exam/exam-intro-service';
import { EXAM_INTRO_RULES } from '@/features/learner-exam/exam-labels';
import type { ExamTestIntro } from '@/features/learner-exam/exam-intro-service';
import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';

import LearnerExamIntroPage, { metadata } from './page';
import ExamIntroNotFound from './not-found';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  useRouter: () => ({
    back: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}));
vi.mock('@/features/learner-auth/server-learner-session', () => ({
  getServerLearnerSession: vi.fn(),
}));
vi.mock('@/features/learner-exam/exam-intro-service', () => ({
  getExamIntro: vi.fn(),
}));

const intro: ExamTestIntro = {
  id: 12,
  title: 'Đề thi thử HSK 3',
  instruction: 'Làm hết các phần trong 80 phút.',
  levelCode: 'HSK3',
  durationMinutes: 80,
  questionCount: 3,
  sectionCount: 2,
  maxScore: 200,
  passScore: 120,
  sections: [
    {
      orderIndex: 1,
      title: 'Nghe hiểu',
      skill: 'listening',
      questionCount: 1,
      maxScore: 100,
    },
    {
      orderIndex: 2,
      title: 'Đọc hiểu',
      skill: 'reading',
      questionCount: 2,
      maxScore: 100,
    },
  ],
  activeAttempt: null,
};

function activeIntro(): ExamTestIntro {
  return {
    ...intro,
    activeAttempt: {
      id: 77,
      startedAt: '2026-10-27T02:00:00.000Z',
      expiresAt: '2026-10-27T03:20:00.000Z',
      answeredCount: 0,
      questionCount: 3,
    },
  };
}

async function renderPage(testId = '12') {
  return render(
    <LearnerToastProvider>
      {await LearnerExamIntroPage({ params: Promise.resolve({ testId }) })}
    </LearnerToastProvider>,
  );
}

function backendError(status: number) {
  return new BackendRequestError(normalizeApiFailure({ status }));
}

const RULES = EXAM_INTRO_RULES;

describe('LearnerExamIntroPage', () => {
  beforeEach(() => {
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'learner',
      token: 'learner-token',
      user: { id: 1, email: 'learner@example.test', role: 'user' },
    });
    vi.mocked(getExamIntro).mockResolvedValue(intro);
    vi.mocked(notFound).mockClear();
    vi.mocked(redirect).mockClear();
  });

  it('keeps the documented page title', () => {
    expect(metadata.title).toBe('Giới thiệu đề');
  });

  it.each(['abc', '0', '-1', '1.5', '2147483648'])(
    'renders not-found for the malformed id %s',
    async (testId) => {
      await expect(renderPage(testId)).rejects.toThrow('NEXT_NOT_FOUND');
      expect(getExamIntro).not.toHaveBeenCalled();
    },
  );

  it.each([404, 400])(
    'renders not-found when the backend answers %s',
    async (status) => {
      vi.mocked(getExamIntro).mockRejectedValue(backendError(status));
      await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    },
  );

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
      vi.mocked(getExamIntro).mockRejectedValue(backendError(status));
      await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/sign-in');
    },
  );

  it('does not send a learner to onboarding', async () => {
    await renderPage();
    expect(redirect).not.toHaveBeenCalled();
    expect(screen.getByText('Đề thi thử HSK 3')).toBeDefined();
  });

  it('renders the hero, the four-column table and the pass score', async () => {
    await renderPage();

    // Kicker and the focus-bar label both carry the level.
    expect(screen.getAllByText('HSK 3')).toHaveLength(2);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Đề thi thử HSK 3' }),
    ).toBeDefined();
    expect(screen.getByText(intro.instruction ?? '')).toBeDefined();

    const table = screen.getByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headers).toEqual(['Phần', 'Nội dung', 'Số câu', 'Điểm']);
    expect(within(table).queryByText(/Thời gian/u)).toBeNull();

    const rows = within(table).getAllByRole('row');
    // header + 2 sections + total
    expect(rows).toHaveLength(4);
    expect(within(table).getByText('Nghe hiểu')).toBeDefined();
    expect(within(table).getByText('Đọc hiểu')).toBeDefined();
    expect(within(table).getByText('Tổng cộng')).toBeDefined();
    // W8 (mockup): the cell carries the bare number; the column header owns
    // the unit ("Số câu", "Điểm").
    expect(within(table).getByText('3')).toBeDefined();
    expect(within(table).getByText('200')).toBeDefined();
    const bodyRows = within(table).getAllByRole('row').slice(1);
    const cellsOf = (row: HTMLElement) => within(row).getAllByRole('cell');
    const first = cellsOf(bodyRows[0] as HTMLElement);
    expect(first[0]?.textContent).toBe('1');
    expect(first[1]?.textContent).toContain('Nghe hiểu');
    expect(first[1]?.textContent).toContain('Nghe');
    expect(first[2]?.textContent).toBe('1');
    expect(first[3]?.textContent).toBe('100');
    const second = cellsOf(bodyRows[1] as HTMLElement);
    expect(second[0]?.textContent).toBe('2');
    expect(second[1]?.textContent).toContain('Đọc hiểu');
    expect(second[1]?.textContent).toContain('Đọc');
    expect(second[2]?.textContent).toBe('2');
    expect(second[3]?.textContent).toBe('100');
    expect(
      within(table)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
        .filter((text) => /câu|điểm/u.test(text ?? '')),
    ).toEqual([]);
    expect(screen.getByText('Điểm đạt: 120/200')).toBeDefined();
  });

  it('hides the pass score line when the test has none', async () => {
    vi.mocked(getExamIntro).mockResolvedValue({ ...intro, passScore: null });
    await renderPage();
    expect(screen.queryByText(/Điểm đạt/u)).toBeNull();
  });

  it('renders the mobile part list with a score per part', async () => {
    await renderPage();
    const list = screen.getByTestId('exam-parts-list');
    expect(within(list).getByText('1')).toBeDefined();
    expect(within(list).getByText('Nghe hiểu')).toBeDefined();
    expect(within(list).getByText('1 câu · Nghe')).toBeDefined();
    expect(within(list).getByText('2 câu · Đọc')).toBeDefined();
    expect(within(list).getAllByText('100 điểm')).toHaveLength(2);
    expect(within(list).getByText('3 câu · 80 phút')).toBeDefined();
  });

  it('renders exactly the three exam rules', async () => {
    await renderPage();
    const rules = screen.getByRole('list', { name: 'Quy định khi thi' });
    expect(within(rules).getAllByRole('listitem')).toHaveLength(3);
    for (const rule of RULES) {
      expect(within(rules).getByText(rule)).toBeDefined();
    }
    expect(screen.queryByText(/Không thoát giữa bài/u)).toBeNull();
    expect(screen.queryByText(/tốc độ 0,75/u)).toBeNull();
  });

  it('offers the start button and the back link when nothing is in progress', async () => {
    await renderPage();
    expect(screen.getByRole('button', { name: 'Bắt đầu thi' })).toBeDefined();
    const actions = screen.getByTestId('exam-actions');
    expect(
      within(actions).getByRole('link', { name: 'Quay lại' }),
    ).toBeDefined();
    expect(screen.queryByText('Bài đang làm')).toBeNull();
  });

  it('shows the in-progress card and hides the start button', async () => {
    vi.mocked(getExamIntro).mockResolvedValue(activeIntro());
    await renderPage();

    expect(screen.getByText('Bài đang làm')).toBeDefined();
    expect(
      screen.getByText('Đã làm 0/3 câu · hết giờ lúc 10:20'),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Bắt đầu thi' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Làm tiếp' })).toBeDefined();
  });
});

describe('ExamIntroNotFound', () => {
  it('renders the not-found message with a way back', () => {
    render(
      <LearnerToastProvider>
        <ExamIntroNotFound />
      </LearnerToastProvider>,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Không tìm thấy đề thi' }),
    ).toBeDefined();
    expect(
      screen.getByText('Đề thi này không tồn tại hoặc chưa mở.'),
    ).toBeDefined();
    expect(screen.getByRole('link', { name: 'Về trang học' })).toBeDefined();
  });
});
