import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notFound, redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import type { LessonActivity } from '@/features/learner-lesson/lesson-activity-contract';
import { getLessonActivity } from '@/features/learner-lesson/lesson-activity-service';
import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';
import {
  getCurrentGoal,
  getOnboardingStatus,
} from '@/features/onboarding/onboarding-service';
import type { OnboardingStatus } from '@/features/onboarding/onboarding-contract';
import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';

import LessonNotFound from './not-found';
import LearnerLessonPage, { metadata } from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/features/learner-auth/server-learner-session', () => ({
  getServerLearnerSession: vi.fn(),
}));
vi.mock('@/features/learner-lesson/lesson-activity-service', () => ({
  getLessonActivity: vi.fn(),
}));
vi.mock('@/features/onboarding/onboarding-service', () => ({
  getOnboardingStatus: vi.fn(),
  getCurrentGoal: vi.fn(),
}));

const current: LessonActivity = {
  lesson: {
    id: 5,
    title: 'Chào hỏi',
    description: 'Lời chào trong ngày.',
  },
  progress: { completionPercent: 67, status: 'learning', score: null },
  level: { id: 1, code: 'HSK1', name: 'HSK 1' },
  position: 1,
  state: 'current',
  sections: {
    vocabulary: { wordCount: 6, topicCount: 1, topicsDone: 1 },
    grammar: { topicCount: 2, topicsDone: 1 },
    practice: { exerciseCount: 3, attempted: 2 },
  },
};

const locked: LessonActivity = {
  lesson: { id: 6, title: 'Gia đình', description: null },
  progress: { completionPercent: 0, status: 'not_started', score: null },
  level: { id: 1, code: 'HSK1', name: 'HSK 1' },
  position: 2,
  state: 'locked',
  sections: {
    vocabulary: { wordCount: 3, topicCount: 1, topicsDone: 0 },
    grammar: { topicCount: 1, topicsDone: 0 },
    practice: { exerciseCount: 0, attempted: 0 },
  },
};

function status(nextStep: OnboardingStatus['nextStep']): OnboardingStatus {
  return {
    hasActiveGoal: nextStep !== 'set_goal',
    hasActiveLearningPlan: nextStep === 'ready',
    hasUsableLearningPlan: nextStep === 'ready',
    hasCompletedPlacement: false,
    nextStep,
  };
}

function backendError(status: number) {
  return new BackendRequestError(normalizeApiFailure({ status }));
}

function page(id: string) {
  return LearnerLessonPage({ params: Promise.resolve({ id }) });
}

async function renderLesson(activity: LessonActivity, id = '5') {
  vi.mocked(getLessonActivity).mockResolvedValue(activity);
  const element = await page(id);
  return render(<LearnerToastProvider>{element}</LearnerToastProvider>);
}

/** Accessible name as the m25a script reads it: aria-hidden parts dropped. */
function spokenName(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone
    .querySelectorAll('[aria-hidden="true"]')
    .forEach((node) => node.remove());
  return (clone.textContent ?? '')
    .replace(/\s+/g, ' ')
    .replace(/ ([,.])/g, '$1')
    .trim();
}

describe('LearnerLessonPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'learner',
      user: { id: 1, email: 'learner@example.com', role: 'user' },
      token: 'learner-token',
    });
    vi.mocked(getOnboardingStatus).mockResolvedValue(status('ready'));
  });

  it('sets the page title', () => {
    expect(metadata.title).toBe('Bài học');
  });

  it.each(['abc', '0', '-1', '99999999999', '2147483648', '01'])(
    'calls notFound for id %j before any backend call',
    async (id) => {
      await expect(page(id)).rejects.toThrow('NEXT_NOT_FOUND');
      expect(getServerLearnerSession).not.toHaveBeenCalled();
      expect(getOnboardingStatus).not.toHaveBeenCalled();
      expect(getLessonActivity).not.toHaveBeenCalled();
    },
  );

  it('reads the activity of the route id', async () => {
    await renderLesson(current, '2147483647');
    expect(getLessonActivity).toHaveBeenCalledWith('learner-token', 2147483647);
  });

  it('calls notFound when the backend has no ready lesson', async () => {
    vi.mocked(getLessonActivity).mockRejectedValue(backendError(404));
    await expect(page('999999')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(1);
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each([401, 403])('redirects to /sign-in on %i', async (status) => {
    vi.mocked(getLessonActivity).mockRejectedValue(backendError(status));
    await expect(page('5')).rejects.toThrow('NEXT_REDIRECT:/sign-in');
  });

  it('redirects to /sign-in without a learner session', async () => {
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'unauthenticated',
      token: null,
    });
    await expect(page('5')).rejects.toThrow('NEXT_REDIRECT:/sign-in');
    expect(getLessonActivity).not.toHaveBeenCalled();
  });

  it('rethrows other backend failures to the error boundary', async () => {
    const failure = backendError(503);
    vi.mocked(getLessonActivity).mockRejectedValue(failure);
    await expect(page('5')).rejects.toBe(failure);
    expect(notFound).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each([
    ['set_goal', '/onboarding/goal'],
    ['content_unavailable', '/onboarding/goal?notice=content_unavailable'],
  ] as const)('sends onboarding step %s to %s', async (nextStep, url) => {
    vi.mocked(getOnboardingStatus).mockResolvedValue(status(nextStep));
    await expect(page('5')).rejects.toThrow(`NEXT_REDIRECT:${url}`);
    expect(getLessonActivity).not.toHaveBeenCalled();
  });

  it('sends generate_plan to the plan step of the current goal', async () => {
    vi.mocked(getOnboardingStatus).mockResolvedValue(status('generate_plan'));
    vi.mocked(getCurrentGoal).mockResolvedValue({
      id: 1,
      targetLevelId: 1,
      targetBand: 1,
      dailyMinutes: 15,
      learningPurpose: 'work',
      reminderEnabled: false,
      reminderTime: null,
      startDate: '2026-10-01',
      isActive: true,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      targetLevel: {
        id: 1,
        code: 'HSK1',
        name: 'HSK 1',
        minBand: 1,
        maxBand: 1,
      },
    });
    await expect(page('5')).rejects.toThrow(
      'NEXT_REDIRECT:/onboarding/plan?purpose=work&band=1',
    );
  });

  it('renders header, hero and one h1 for an open lesson', async () => {
    const { container } = await renderLesson(current);
    expect(container.querySelector('.m02-bar__title')?.textContent).toBe(
      'Chào hỏi',
    );
    expect(
      screen.getByRole('link', { name: 'Quay lại lộ trình' }),
    ).toHaveAttribute('href', '/learn/path');
    const fav = screen.getByRole('button', { name: 'Yêu thích bài học' });
    expect(fav).not.toHaveAttribute('aria-pressed');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Chào hỏi' }),
    ).toBeInTheDocument();
    expect(container.querySelector('.lesson-hero__badge')?.textContent).toBe(
      'HSK 1 •, Bài 1',
    );
    expect(container.querySelector('.lesson-hero__img')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(container.querySelector('.lesson-hero__desc')?.textContent).toBe(
      'Lời chào trong ngày.',
    );
    const bar = screen.getByRole('progressbar', { name: 'Tiến độ bài học' });
    expect(bar).toHaveAttribute('aria-valuenow', '67');
    expect(bar.firstElementChild).toHaveClass('pct-67');
    expect(container.querySelector('.lesson-hero__pct')?.textContent).toBe(
      '67% hoàn thành',
    );
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('renders rows with counts, bars and spoken names (Q35, Q36)', async () => {
    const { container } = await renderLesson(current);
    const rows = Array.from(container.querySelectorAll('.lesson-rows .lrow'));
    expect(rows.map((row) => row.getAttribute('class'))).toEqual([
      'lrow is-done',
      'lrow lrow--violet',
      'lrow lrow--blue',
    ]);
    expect(rows.map(spokenName)).toEqual([
      'Từ vựng, 6 từ mới, đã học xong',
      'Ngữ pháp, 2 điểm ngữ pháp, 1/2 đã học',
      'Luyện tập, 3 bài luyện tập, 2/3 đã làm',
    ]);
    expect(rows[0]?.querySelector('.lrow__bar')).toBeNull();
    expect(rows[1]?.querySelector('.lrow__bar > span')).toHaveClass('pct-50');
    expect(rows[2]?.querySelector('.lrow__bar > span')).toHaveClass('pct-67');
    expect(rows.map((row) => row.tagName)).toEqual(['BUTTON', 'BUTTON', 'A']);
    for (const row of rows) {
      expect(row).not.toHaveAttribute('aria-disabled');
      expect(row.querySelector('img')).toHaveAttribute('alt', '');
    }
  });

  it('links row Luyện tập of an open lesson to the player (Q45)', async () => {
    const { container } = await renderLesson(current);
    const row = Array.from(container.querySelectorAll('.lrow')).find(
      (candidate) =>
        candidate.querySelector('.lrow__title')?.textContent === 'Luyện tập',
    );
    expect(row?.tagName).toBe('A');
    expect(row).toHaveAttribute('href', '/learn/lessons/5/practice');
    if (row) fireEvent.click(row);
    expect(screen.queryByText('Tính năng sắp ra mắt.')).toBeNull();
  });

  it.each(['Từ vựng', 'Ngữ pháp'])(
    'shows the coming-soon toast for row %s (Q38)',
    async (title) => {
      const { container } = await renderLesson(current);
      const row = Array.from(container.querySelectorAll('.lrow')).find(
        (candidate) =>
          candidate.querySelector('.lrow__title')?.textContent === title,
      );
      if (!row) throw new Error(`missing row ${title}`);
      fireEvent.click(row);
      expect(
        within(screen.getByRole('status')).getByText('Tính năng sắp ra mắt.'),
      ).toBeInTheDocument();
    },
  );

  it('links the CTA to the player and toasts the heart (Q33, Q45)', async () => {
    await renderLesson(current);
    expect(screen.queryByRole('button', { name: 'Tiếp tục học' })).toBeNull();
    const cta = screen.getByRole('link', { name: 'Tiếp tục học' });
    expect(cta).toHaveClass('lesson-cta');
    expect(cta).toHaveAttribute('href', '/learn/lessons/5/practice');
    expect(cta).not.toHaveAttribute('aria-disabled');
    fireEvent.click(screen.getByRole('button', { name: 'Yêu thích bài học' }));
    expect(
      within(screen.getByRole('status')).getAllByText('Tính năng sắp ra mắt.'),
    ).toHaveLength(1);
  });

  it('keeps row Luyện tập of a locked lesson a lock toast, not a link (Q44)', async () => {
    const { container } = await renderLesson(
      {
        ...locked,
        sections: {
          ...locked.sections,
          practice: { exerciseCount: 2, attempted: 0 },
        },
      },
      '6',
    );
    const row = Array.from(container.querySelectorAll('.lrow')).find(
      (candidate) =>
        candidate.querySelector('.lrow__title')?.textContent === 'Luyện tập',
    );
    if (!row) throw new Error('missing row Luyện tập');
    expect(row.tagName).toBe('BUTTON');
    expect(row).toHaveAttribute('aria-disabled', 'true');
    expect(container.querySelector('a[href$="/practice"]')).toBeNull();
    fireEvent.click(row);
    expect(
      within(screen.getByRole('status')).getByText(
        'Hoàn thành bài trước để mở khoá.',
      ),
    ).toBeInTheDocument();
  });

  it('hides a missing description (Q39) and a zero-total row (Q35)', async () => {
    const { container } = await renderLesson(locked, '6');
    expect(container.querySelector('.lesson-hero__desc')).toBeNull();
    expect(
      Array.from(container.querySelectorAll('.lrow__title')).map(
        (title) => title.textContent,
      ),
    ).toEqual(['Từ vựng', 'Ngữ pháp']);
  });

  it('renders a locked lesson with lock rows and a grey CTA (Q40, Q44)', async () => {
    const { container } = await renderLesson(locked, '6');
    const rows = Array.from(container.querySelectorAll('.lesson-rows .lrow'));
    expect(rows.map(spokenName)).toEqual([
      'Từ vựng, 3 từ mới, đã khoá',
      'Ngữ pháp, 1 điểm ngữ pháp, đã khoá',
    ]);
    for (const row of rows) {
      expect(row).toHaveClass('is-locked');
      expect(row).toHaveAttribute('aria-disabled', 'true');
      expect(row).not.toHaveAttribute('disabled');
      expect(row.querySelector('.lrow__lock')).not.toBeNull();
      expect(row.querySelector('.lrow__count, .lrow__bar')).toBeNull();
    }
    const cta = screen.getByRole('button', { name: 'Tiếp tục học' });
    expect(cta).toHaveAttribute('aria-disabled', 'true');
    expect(cta).not.toHaveAttribute('disabled');
    expect(container.querySelector('.lesson-hero__badge')?.textContent).toBe(
      'HSK 1 •, Bài 2',
    );

    fireEvent.click(cta);
    const first = rows[0];
    if (!first) throw new Error('missing row');
    fireEvent.click(first);
    const status = screen.getByRole('status');
    expect(
      within(status).getAllByText('Hoàn thành bài trước để mở khoá.'),
    ).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Yêu thích bài học' }));
    expect(
      within(status).getByText('Tính năng sắp ra mắt.'),
    ).toBeInTheDocument();
  });

  it('labels HSK 7–9 in the chip', async () => {
    const { container } = await renderLesson({
      ...current,
      level: { id: 7, code: 'HSK7_9', name: 'HSK 7-9' },
      position: 12,
    });
    expect(container.querySelector('.lesson-hero__badge')?.textContent).toBe(
      'HSK 7–9 •, Bài 12',
    );
  });
});

describe('LessonNotFound', () => {
  it('shows the Vietnamese not-found page with a link back to the path (Q41)', () => {
    const { container } = render(<LessonNotFound />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Không tìm thấy bài học' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Bài học này không tồn tại hoặc chưa mở.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Về lộ trình' })).toHaveAttribute(
      'href',
      '/learn/path',
    );
    expect(
      screen.getByRole('link', { name: 'Quay lại lộ trình' }),
    ).toHaveAttribute('href', '/learn/path');
    expect(container.querySelector('.m02-bar__title')?.textContent).toBe(
      'Bài học',
    );
    expect(container.querySelector('.lesson-fav, .lesson-hero')).toBeNull();
  });
});
