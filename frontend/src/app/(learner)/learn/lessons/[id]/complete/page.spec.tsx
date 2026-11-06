import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import type { LessonActivity } from '@/features/learner-lesson/lesson-activity-contract';
import { getLessonActivity } from '@/features/learner-lesson/lesson-activity-service';
import type { LearningPath } from '@/features/learner-path/learning-path-contract';
import { getLearningPath } from '@/features/learner-path/learning-path-service';
import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';
import type { OnboardingStatus } from '@/features/onboarding/onboarding-contract';
import { getOnboardingStatus } from '@/features/onboarding/onboarding-service';
import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';

import LessonCompletePage, { metadata } from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/features/learner-auth/server-learner-session', () => ({
  getServerLearnerSession: vi.fn(),
}));
vi.mock('@/features/learner-lesson/lesson-activity-service', () => ({
  getLessonActivity: vi.fn(),
}));
vi.mock('@/features/learner-path/learning-path-service', () => ({
  getLearningPath: vi.fn(),
}));
vi.mock('@/features/onboarding/onboarding-service', () => ({
  getOnboardingStatus: vi.fn(),
  getCurrentGoal: vi.fn(),
}));

const status: OnboardingStatus = {
  hasActiveGoal: true,
  hasActiveLearningPlan: true,
  hasUsableLearningPlan: true,
  hasCompletedPlacement: false,
  nextStep: 'ready',
};

function activity(
  progress: Partial<LessonActivity['progress']> = {},
): LessonActivity {
  return {
    lesson: { id: 5, title: 'Mua sắm', description: null },
    progress: {
      completionPercent: 100,
      status: 'done',
      score: 91.5,
      ...progress,
    },
    level: { id: 2, code: 'HSK2', name: 'HSK 2' },
    position: 1,
    state: 'done',
    sections: {
      vocabulary: { wordCount: 0, topicCount: 1, topicsDone: 1 },
      grammar: { topicCount: 0, topicsDone: 0 },
      practice: { exerciseCount: 2, attempted: 2 },
    },
  };
}

function lesson(id: number, position: number) {
  return {
    id,
    title: `Bài ${id}`,
    slug: `bai-${id}`,
    position,
    state: 'available' as const,
    completionPercent: 0,
  };
}

function path(hsk2Lessons: ReturnType<typeof lesson>[]): LearningPath {
  return {
    nextStep: 'ready',
    goal: null,
    nextLesson: null,
    levels: [
      {
        id: 1,
        code: 'HSK1',
        name: 'HSK 1',
        orderIndex: 1,
        lessonCount: 1,
        completedCount: 0,
        lessons: [lesson(4, 1)],
      },
      {
        id: 2,
        code: 'HSK2',
        name: 'HSK 2',
        orderIndex: 2,
        lessonCount: hsk2Lessons.length,
        completedCount: 1,
        lessons: hsk2Lessons,
      },
    ],
  };
}

function page(id: string) {
  return LessonCompletePage({ params: Promise.resolve({ id }) });
}

async function renderComplete() {
  return render(<LearnerToastProvider>{await page('5')}</LearnerToastProvider>);
}

describe('LessonCompletePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'learner',
      user: { id: 1, email: 'learner@example.com', role: 'user' },
      token: 'learner-token',
    });
    vi.mocked(getOnboardingStatus).mockResolvedValue(status);
    vi.mocked(getLessonActivity).mockResolvedValue(activity());
    // Out of order on purpose: the next lesson is by position, not array order.
    vi.mocked(getLearningPath).mockResolvedValue(
      path([lesson(9, 3), lesson(5, 1), lesson(7, 2)]),
    );
  });

  it('sets the page title', () => {
    expect(metadata.title).toBe('Hoàn thành bài học');
  });

  it.each(['learning', 'not_started'] as const)(
    'sends a %s lesson back to its lesson page without reading the path',
    async (progressStatus) => {
      vi.mocked(getLessonActivity).mockResolvedValue(
        activity({ status: progressStatus, score: null }),
      );
      await expect(page('5')).rejects.toThrow('NEXT_REDIRECT:/learn/lessons/5');
      expect(getLearningPath).not.toHaveBeenCalled();
    },
  );

  it.each(['abc', '0', '2147483648'])(
    'calls notFound for id %s before reading the session',
    async (id) => {
      await expect(page(id)).rejects.toThrow('NEXT_NOT_FOUND');
      expect(getServerLearnerSession).not.toHaveBeenCalled();
    },
  );

  it('calls notFound when the backend has no ready lesson (Q41)', async () => {
    vi.mocked(getLessonActivity).mockRejectedValue(
      new BackendRequestError(normalizeApiFailure({ status: 404 })),
    );
    await expect(page('5')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('shows the lesson title and the rounded Progress.score twice', async () => {
    const { container } = await renderComplete();
    expect(getLessonActivity).toHaveBeenCalledWith('learner-token', 5);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Mua sắm' }),
    ).toBeInTheDocument();
    expect(container.querySelector('.done-kicker')?.textContent).toBe(
      'Chúc mừng! Bạn đã hoàn thành bài học',
    );
    const medal = container.querySelector('.done-medal__score');
    expect(medal?.textContent).toBe('92%');
    expect(medal).toHaveAttribute('aria-label', 'Điểm 92%');
    const stats = container.querySelectorAll('.done-stat');
    expect(stats).toHaveLength(1);
    expect(stats[0]?.querySelector('h2')?.textContent).toBe('Điểm số của bạn');
    expect(stats[0]?.querySelector('.done-stat__score')?.textContent).toBe(
      '92%',
    );
  });

  it('has no XP or achievement (Q59) and keeps the confetti hidden from AT', async () => {
    const { container } = await renderComplete();
    expect(container.querySelector('.done-ach')).toBeNull();
    const text = container.textContent ?? '';
    for (const word of ['XP', 'Kinh nghiệm', 'Thành tích']) {
      expect(text).not.toContain(word);
    }
    const confetti = container.querySelector('.done-confetti');
    expect(confetti).toHaveAttribute('aria-hidden', 'true');
    expect(confetti?.children.length).toBe(21);
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('links Bài tiếp theo to the next lesson of the Level by position (Q61)', async () => {
    await renderComplete();
    expect(screen.getByRole('link', { name: 'Bài tiếp theo' })).toHaveAttribute(
      'href',
      '/learn/lessons/7',
    );
  });

  it('turns the button into Về lộ trình after the last lesson of the Level (Q61)', async () => {
    vi.mocked(getLearningPath).mockResolvedValue(
      path([lesson(3, 1), lesson(5, 2)]),
    );
    await renderComplete();
    expect(screen.getByRole('link', { name: 'Về lộ trình' })).toHaveAttribute(
      'href',
      '/learn/path',
    );
    expect(screen.queryByRole('link', { name: 'Bài tiếp theo' })).toBeNull();
  });

  it('Ôn từ mới is a button that only toasts (Q60)', async () => {
    await renderComplete();
    const review = screen.getByRole('button', { name: 'Ôn từ mới' });
    fireEvent.click(review);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Tính năng sắp ra mắt.',
    );
  });

  it('shows "—" labelled "Chưa có điểm" when the done lesson has no score', async () => {
    vi.mocked(getLessonActivity).mockResolvedValue(activity({ score: null }));
    const { container } = await renderComplete();
    for (const selector of ['.done-medal__score', '.done-stat__score']) {
      const node = container.querySelector(selector);
      expect(node?.textContent).toBe('—');
      expect(node?.getAttribute('aria-label')).toBe('Chưa có điểm');
    }
  });
});
