import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notFound, redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import { getExamAttempt } from '@/features/learner-exam/exam-attempt-service';
import type { ExamResultViewParsed } from '@/features/learner-exam/exam-contract';
import {
  EXAM_RESULT_NO_WEAK_AREAS,
  EXAM_RESULT_NO_XP,
  EXAM_RESULT_RETRY_TEXT,
} from '@/features/learner-exam/exam-result-model';
import { getExamResult } from '@/features/learner-exam/exam-result-service';
import { BackendRequestError } from '@/lib/api/api-error';

import LearnerExamResultPage, { metadata } from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/features/learner-auth/server-learner-session', () => ({
  getServerLearnerSession: vi.fn(),
}));
vi.mock('@/features/learner-exam/exam-result-service', () => ({
  getExamResult: vi.fn(),
}));
vi.mock('@/features/learner-exam/exam-attempt-service', () => ({
  getExamAttempt: vi.fn(),
}));

function result(
  overrides: Partial<ExamResultViewParsed> = {},
): ExamResultViewParsed {
  return {
    attemptId: 41,
    testId: 7,
    status: 'submitted',
    testTitle: 'Đề thi thử HSK 3',
    startedAt: '2025-05-19T01:28:18.000Z',
    submittedAt: '2025-05-19T02:00:00.000Z',
    score: 248,
    maxScore: 300,
    passScore: 180,
    passed: true,
    scoringVersion: 'exam-score-v1',
    gradedAt: '2025-05-19T02:00:01.000Z',
    counts: {
      answeredCount: 38,
      correctCount: 33,
      incorrectCount: 5,
      unansweredCount: 2,
    },
    sections: [
      {
        key: 's1',
        title: 'Nghe hiểu',
        skill: 'listening',
        questionCount: 15,
        correctCount: 13,
        score: 86,
        maxScore: 100,
      },
    ],
    skills: [
      { skill: 'listening', score: 86, maxScore: 100 },
      { skill: 'reading', score: 84, maxScore: 100 },
      { skill: 'writing', score: 78, maxScore: 100 },
    ],
    weakAreas: [
      {
        slug: 'tu-vung-hoc-thuat',
        name: 'Từ vựng học thuật',
        answered: 4,
        correct: 1,
        accuracy: 25,
        level: 'weak',
      },
      {
        slug: 'phan-biet-am',
        name: 'Phân biệt âm',
        answered: 5,
        correct: 3,
        accuracy: 60,
        level: 'medium',
      },
    ],
    ...overrides,
  };
}

function backendFailure(status: number, code?: string): BackendRequestError {
  return new BackendRequestError({
    status,
    kind: status === 409 ? 'conflict' : 'not_found',
    message: 'failure',
    retryable: false,
    ...(code === undefined ? {} : { code }),
  });
}

function hero(container: HTMLElement, variant: 'web' | 'mobile'): HTMLElement {
  const element = container.querySelector(`.exr-hero--${variant}`);
  if (element === null) throw new Error(`missing ${variant} hero`);
  return element as HTMLElement;
}

async function renderPage(id = '41') {
  return render(
    await LearnerExamResultPage({ params: Promise.resolve({ attemptId: id }) }),
  );
}

describe('LearnerExamResultPage (M4.3, TL-172)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'learner',
      token: 'token',
    } as never);
    vi.mocked(getExamResult).mockResolvedValue(result());
    vi.mocked(getExamAttempt).mockResolvedValue({ testId: 7 } as never);
  });

  it('renders the score, skills, weak areas, retry link and the Q14 line', async () => {
    const { container } = await renderPage();
    const web = within(hero(container, 'web'));
    const mobile = within(hero(container, 'mobile'));

    expect(metadata.title).toBe('Kết quả bài thi');
    expect(web.getAllByText('Bạn đã đạt!')).toHaveLength(1);
    expect(mobile.getAllByText('Bạn đã đạt!')).toHaveLength(1);
    expect(container.querySelector('.exr-badge')?.textContent).toContain('Đạt');
    expect(container.querySelector('.exr-hero__badge')?.textContent).toContain(
      'Đạt',
    );
    expect(web.getByText('248')).toBeDefined();
    expect(web.getByText('/300 điểm')).toBeDefined();
    expect(web.getByText('Điểm đạt từ 180/300')).toBeDefined();
    expect(web.getByText('Thời gian làm bài 31:42')).toBeDefined();
    expect(web.getByText('Ngày thi 19/05/2025')).toBeDefined();
    expect(mobile.getByText('/300 điểm')).toBeDefined();
    expect(mobile.getByText('Ngày thi 19/05/2025')).toBeDefined();
    expect(screen.getByText('Kết quả theo kỹ năng')).toBeDefined();
    expect(screen.getByText('Nghe')).toBeDefined();
    expect(screen.getByText('86/100')).toBeDefined();
    expect(
      screen.getByRole('progressbar', { name: 'Nghe: 86 trên 100 điểm' }),
    ).toBeDefined();
    expect(screen.getByText('Điểm yếu cần cải thiện')).toBeDefined();
    expect(screen.getByText('Từ vựng học thuật')).toBeDefined();
    expect(screen.getByText('Yếu')).toBeDefined();
    expect(screen.getByText('Trung bình')).toBeDefined();
    expect(
      screen.getByRole('link', { name: 'Làm lại đề này' }).getAttribute('href'),
    ).toBe('/learn/exam/7');
    expect(screen.getByText(EXAM_RESULT_NO_XP)).toBeDefined();
  });

  it('shows the failed badge and the timed-out chip (Q165)', async () => {
    vi.mocked(getExamResult).mockResolvedValue(
      result({ passed: false, status: 'timed_out' }),
    );
    const { container } = await renderPage();
    const web = within(hero(container, 'web'));

    expect(web.getByText('Bạn chưa đạt')).toBeDefined();
    expect(container.querySelector('.exr-badge')?.textContent).toContain(
      'Chưa đạt',
    );
    expect(web.getByText('Hết giờ · tự nộp')).toBeDefined();
  });

  it('drops the badge and explains a missing pass score when passed is null (Q165)', async () => {
    vi.mocked(getExamResult).mockResolvedValue(
      result({ passed: null, passScore: null }),
    );
    const { container } = await renderPage();

    const web = within(hero(container, 'web'));
    expect(container.querySelector('.exr-badge')).toBeNull();
    expect(container.querySelector('.exr-hero__badge')).toBeNull();
    expect(web.getByText('Đề này chưa đặt điểm đạt')).toBeDefined();
    expect(screen.queryByText(/Điểm đạt từ/u)).toBeNull();
  });

  it('formats a duration of one hour or more as h:mm:ss (Q168)', async () => {
    vi.mocked(getExamResult).mockResolvedValue(
      result({
        startedAt: '2025-05-19T00:57:57.000Z',
        submittedAt: '2025-05-19T02:00:00.000Z',
      }),
    );
    const { container } = await renderPage();
    expect(
      within(hero(container, 'web')).getByText('Thời gian làm bài 1:02:03'),
    ).toBeDefined();
  });

  it('shows the empty weak-area copy when the backend returns none (Q166)', async () => {
    vi.mocked(getExamResult).mockResolvedValue(result({ weakAreas: [] }));
    await renderPage();
    expect(screen.getByText(EXAM_RESULT_NO_WEAK_AREAS)).toBeDefined();
  });

  it('redirects an in-progress attempt back to the taking page (Q167)', async () => {
    vi.mocked(getExamResult).mockRejectedValue(
      backendFailure(409, 'EXAM_ATTEMPT_NOT_TERMINAL'),
    );
    await expect(renderPage()).rejects.toThrow(
      'NEXT_REDIRECT:/learn/exam/attempts/41',
    );
    expect(redirect).toHaveBeenCalledWith('/learn/exam/attempts/41');
  });

  it('shows a role=alert retry block when the result is unavailable (Q167)', async () => {
    vi.mocked(getExamResult).mockRejectedValue(
      backendFailure(409, 'EXAM_RESULT_UNAVAILABLE'),
    );
    await renderPage();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(EXAM_RESULT_RETRY_TEXT);
    expect(
      screen.getByRole('link', { name: 'Thử lại' }).getAttribute('href'),
    ).toBe('/learn/exam/attempts/41/result');
  });

  it('shows the cancelled copy and the intro link for a closed attempt (Q167)', async () => {
    vi.mocked(getExamResult).mockRejectedValue(
      backendFailure(409, 'EXAM_ATTEMPT_CLOSED'),
    );
    await renderPage();

    expect(
      screen.getByText('Bài thi đã bị huỷ, không có kết quả.'),
    ).toBeDefined();
    expect(
      screen
        .getByRole('link', { name: 'Về màn giới thiệu đề' })
        .getAttribute('href'),
    ).toBe('/learn/exam/7');
    expect(getExamAttempt).toHaveBeenCalledWith(41, 'token');
  });

  it('not-founds a 404 and redirects an expired session (Q167)', async () => {
    vi.mocked(getExamResult).mockRejectedValue(backendFailure(404));
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();

    vi.mocked(getExamResult).mockRejectedValue(backendFailure(401));
    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/sign-in');

    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'anonymous',
    } as never);
    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/sign-in');
  });
});
