import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import { homeDateLabel } from '@/features/learner-home/home-date';
import type { LearningHome } from '@/features/learner-home/learning-home-contract';
import { getLearningHome } from '@/features/learner-home/learning-home-service';
import type {
  CourseDetail,
  CourseSummary,
} from '@/features/learner-course/course-model';
import {
  getCourse,
  getCourses,
} from '@/features/learner-course/course-service';
import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';
import type { UserGoal } from '@/features/onboarding/onboarding-contract';
import { getCurrentGoal } from '@/features/onboarding/onboarding-service';
import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';

import LearnerHomePage, { metadata } from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock('@/features/learner-auth/server-learner-session', () => ({
  getServerLearnerSession: vi.fn(),
}));
vi.mock('@/features/learner-home/learning-home-service', () => ({
  getLearningHome: vi.fn(),
}));
vi.mock('@/features/onboarding/onboarding-service', () => ({
  getCurrentGoal: vi.fn(),
}));
vi.mock('@/features/learner-course/course-service', () => ({
  getCourses: vi.fn(),
  getCourse: vi.fn(),
}));

const readyHome: LearningHome = {
  nextStep: 'ready',
  greetingName: 'Minh',
  dailyGoal: { targetMinutes: 20, minutesToday: 15 },
  streakDays: 3,
  continueLesson: null,
};

const lesson = {
  lessonId: 7,
  title: 'Chào hỏi cơ bản',
  slug: 'chao-hoi',
  levelCode: 'HSK7_9',
  position: 2,
  completionPercent: 40,
};

const goal: UserGoal = {
  id: 11,
  targetLevelId: 2,
  targetBand: 7,
  dailyMinutes: 15,
  learningPurpose: 'hsk_exam',
  reminderEnabled: false,
  reminderTime: null,
  startDate: '2026-10-01',
  isActive: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  targetLevel: {
    id: 2,
    code: 'HSK7_9',
    name: 'HSK 7-9',
    minBand: 7,
    maxBand: 9,
  },
};

function backendError(status: number, code?: string) {
  return new BackendRequestError(
    normalizeApiFailure({
      status,
      body: code === undefined ? null : { error: { code } },
    }),
  );
}

async function renderHome(home: LearningHome) {
  vi.mocked(getLearningHome).mockResolvedValue(home);
  const element = await LearnerHomePage();
  return render(<LearnerToastProvider>{element}</LearnerToastProvider>);
}

describe('LearnerHomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'learner',
      user: { id: 1, email: 'learner@example.com', role: 'user' },
      token: 'learner-token',
    });
    vi.mocked(getCourses).mockResolvedValue([]);
  });

  it('sets the page title', () => {
    expect(metadata.title).toBe('Trang chủ');
  });

  it('redirects to /sign-in without a learner session and skips the home fetch', async () => {
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'unauthenticated',
      token: null,
    });
    await expect(LearnerHomePage()).rejects.toThrow('NEXT_REDIRECT:/sign-in');
    expect(getLearningHome).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    'redirects to /sign-in when the home fetch fails with %i',
    async (status) => {
      vi.mocked(getLearningHome).mockRejectedValue(backendError(status));
      await expect(LearnerHomePage()).rejects.toThrow('NEXT_REDIRECT:/sign-in');
      expect(redirect).toHaveBeenCalledWith('/sign-in');
    },
  );

  it('sends a learner who must accept the legal documents to /consent (M1.7b2 B2a2)', async () => {
    vi.mocked(getLearningHome).mockRejectedValue(
      backendError(403, 'CONSENT_REQUIRED'),
    );
    await expect(LearnerHomePage()).rejects.toThrow(
      'NEXT_REDIRECT:/consent?returnTo=%2Flearn',
    );
    expect(redirect).not.toHaveBeenCalledWith('/sign-in');
  });

  it('rethrows other backend failures', async () => {
    const failure = backendError(503);
    vi.mocked(getLearningHome).mockRejectedValue(failure);
    await expect(LearnerHomePage()).rejects.toBe(failure);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('sends set_goal to /onboarding/goal without fetching the goal', async () => {
    vi.mocked(getLearningHome).mockResolvedValue({
      ...readyHome,
      nextStep: 'set_goal',
    });
    await expect(LearnerHomePage()).rejects.toThrow(
      'NEXT_REDIRECT:/onboarding/goal',
    );
    expect(redirect).toHaveBeenCalledWith('/onboarding/goal');
    expect(getCurrentGoal).not.toHaveBeenCalled();
  });

  it('sends content_unavailable to the goal notice without fetching the goal', async () => {
    vi.mocked(getLearningHome).mockResolvedValue({
      ...readyHome,
      nextStep: 'content_unavailable',
    });
    await expect(LearnerHomePage()).rejects.toThrow(
      'NEXT_REDIRECT:/onboarding/goal?notice=content_unavailable',
    );
    expect(getCurrentGoal).not.toHaveBeenCalled();
  });

  it('sends generate_plan to the plan step using the current goal', async () => {
    vi.mocked(getLearningHome).mockResolvedValue({
      ...readyHome,
      nextStep: 'generate_plan',
    });
    vi.mocked(getCurrentGoal).mockResolvedValue(goal);
    await expect(LearnerHomePage()).rejects.toThrow(
      'NEXT_REDIRECT:/onboarding/plan?purpose=hsk_exam&band=7',
    );
    expect(getCurrentGoal).toHaveBeenCalledTimes(1);
    expect(getCurrentGoal).toHaveBeenCalledWith('learner-token');
  });

  it('renders the heading, date line, gauge and streak when ready', async () => {
    const { container } = await renderHome(readyHome);
    expect(getServerLearnerSession).toHaveBeenCalledTimes(1);
    expect(getLearningHome).toHaveBeenCalledTimes(1);
    expect(getLearningHome).toHaveBeenCalledWith('learner-token');
    expect(redirect).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Hôm nay' }),
    ).toBeInTheDocument();
    expect(container.querySelector('.home-hero__greet p')?.textContent).toBe(
      homeDateLabel(new Date()),
    );

    const goalStat = screen.getByRole('region', { name: 'Mục tiêu hôm nay' });
    expect(goalStat.querySelector('.sr-only')?.textContent).toBe(
      '15 trên 20 phút',
    );
    const gauge = goalStat.querySelector('.home-gauge');
    expect(gauge).toHaveClass('pct-75');
    expect(gauge).toHaveAttribute('aria-hidden', 'true');
    expect(gauge?.querySelector('b')?.textContent).toBe('15/20');
    const streakStat = screen.getByRole('region', { name: 'Chuỗi ngày học' });
    expect(streakStat.querySelector('.sr-only')?.textContent).toBe('3 ngày');
    expect(streakStat.querySelector('.home-streak b')?.textContent).toBe('3');
    expect(streakStat.querySelector('.home-streak')).toHaveAttribute(
      'aria-hidden',
      'true',
    );

    expect(screen.queryByText('Tiếp tục học')).not.toBeInTheDocument();
    expect(container.querySelector('.home-lesson')).toBeNull();
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('keeps the heading without a name and shows an empty gauge', async () => {
    const { container } = await renderHome({
      ...readyHome,
      greetingName: null,
      dailyGoal: null,
    });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Hôm nay' }),
    ).toBeInTheDocument();
    const gauge = container.querySelector('.home-gauge');
    expect(gauge).toHaveClass('pct-0');
    expect(gauge?.querySelector('b')?.textContent).toBe('—');
    expect(
      screen
        .getByRole('region', { name: 'Mục tiêu hôm nay' })
        .querySelector('.sr-only')?.textContent,
    ).toBe('Chưa có mục tiêu');
  });

  it('shows the real minutes past the goal while capping the gauge at 100%', async () => {
    const { container } = await renderHome({
      ...readyHome,
      dailyGoal: { targetMinutes: 20, minutesToday: 25 },
    });
    const gauge = container.querySelector('.home-gauge');
    expect(gauge).toHaveClass('pct-100');
    expect(gauge?.querySelector('b')?.textContent).toBe('25/20');
    expect(screen.getByText('25 trên 20 phút')).toHaveClass('sr-only');
  });

  it('shows the streak unit "ngày" and only the two stat cards, no XP', async () => {
    const { container } = await renderHome(readyHome);
    expect(container.querySelector('.home-streak span')?.textContent).toBe(
      'ngày',
    );
    expect(container.querySelectorAll('.home-stat')).toHaveLength(2);
    expect(container.textContent).not.toContain('XP');
  });

  it('labels the web card button "Bắt đầu" for a lesson not started', async () => {
    const { container } = await renderHome({
      ...readyHome,
      continueLesson: { ...lesson, completionPercent: 0 },
    });
    expect(container.querySelector('.home-lesson__cta')).toHaveTextContent(
      /^Bắt đầu$/u,
    );
    expect(container.querySelector('.w-top .w-chip')).toHaveTextContent(
      `Chuỗi ngày học: ${readyHome.streakDays} ngày`,
    );
  });

  it('renders the continue lesson card as a link to the lesson', async () => {
    const { container } = await renderHome({
      ...readyHome,
      continueLesson: lesson,
    });
    expect(
      screen.getByRole('heading', { level: 2, name: 'Tiếp tục học' }),
    ).toBeInTheDocument();
    const card = container.querySelector('.home-lesson');
    if (!(card instanceof HTMLElement)) throw new Error('missing lesson card');
    expect(card.querySelector('.home-lesson__title')?.textContent).toBe(
      'Chào hỏi cơ bản',
    );
    expect(card.querySelector('.home-lesson__meta')?.textContent).toBe(
      'HSK 7–9 • Bài 2',
    );
    expect(within(card).queryAllByRole('heading')).toHaveLength(0);
    expect(card.querySelector('h1, h2, h3, h4, h5, h6, p, div')).toBeNull();
    expect(card).toHaveTextContent('40%');
    expect(card.querySelector('.progress > span')).toHaveClass('pct-40');
    expect(container.querySelector('[style]')).toBeNull();

    // Web card button (Q83): a lesson under way reads "Tiếp tục học".
    expect(card.querySelector('.home-lesson__cta')).toHaveTextContent(
      /^Tiếp tục học$/u,
    );
    expect(card.querySelector('.home-lesson__cta')).toHaveClass('w-only');

    expect(card.tagName).toBe('A');
    expect(card).toHaveAttribute('href', `/learn/lessons/${lesson.lessonId}`);
    fireEvent.click(card);
    expect(screen.queryByText('Tính năng sắp ra mắt.')).toBeNull();
  });

  it('lists the eight explore shortcuts in order', async () => {
    await renderHome(readyHome);
    const list = screen.getByRole('list', { name: 'Khám phá' });
    // M4.5 B1: "Thi thử" is a real link now, the other seven still toast.
    expect(
      within(list)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Thi thử']);
    expect(
      within(list)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual([
      'Phát âm',
      'Đọc hiểu',
      'Tài liệu',
      'Trợ lý AI',
      'Hội thoại',
      'Nhận diện chữ',
      'Hỗ trợ',
    ]);
    expect(within(list).getByRole('link', { name: 'Thi thử' })).toHaveAttribute(
      'href',
      '/learn/exam',
    );

    fireEvent.click(within(list).getByRole('button', { name: 'Đọc hiểu' }));
    expect(screen.getByText('Tính năng sắp ra mắt.')).toHaveClass('toast');
  });

  it('toasts from the bell and links the avatar to the profile', async () => {
    await renderHome(readyHome);
    // The hero of the mobile layout; the web top bar has its own (M2.10a).
    const hero = within(screen.getByRole('banner'));
    fireEvent.click(hero.getByRole('button', { name: 'Thông báo' }));
    expect(
      screen.getByText('Thông báo sẽ có khi tính năng ra mắt.'),
    ).toHaveClass('toast');
    expect(hero.getByRole('link', { name: 'Hồ sơ' })).toHaveAttribute(
      'href',
      '/learn/profile',
    );
  });

  describe('"Khoá đang học" block (C3b-UI)', () => {
    const summary: CourseSummary = {
      code: 'HSK2_TEXTBOOK',
      kind: 'textbook',
      curriculumVersion: 'HSK_2_0',
      title: 'Giáo trình HSK chuẩn 2.0',
      description: null,
      enrolled: true,
      isCurrent: true,
      progress: { completedLessons: 4, totalLessons: 134 },
    };
    const detail: CourseDetail = {
      ...summary,
      units: [
        {
          orderIndex: 1,
          title: 'Cấp 1',
          gradeNumber: 1,
          volume: null,
          levelCode: null,
          lessons: [
            {
              id: 31,
              title: 'Gia đình',
              slug: 'gia-dinh',
              position: 4,
              state: 'done',
              completionPercent: 100,
            },
            {
              id: 32,
              title: 'Số đếm và tuổi',
              slug: 'so-dem',
              position: 5,
              state: 'current',
              completionPercent: 40,
            },
          ],
        },
      ],
    };
    const other: CourseSummary = {
      ...summary,
      code: 'HSK3_TOPIC',
      title: 'Chủ đề HSK 3.0',
      isCurrent: false,
    };

    it('shows the current course and its current lesson', async () => {
      vi.mocked(getCourses).mockResolvedValue([other, summary]);
      vi.mocked(getCourse).mockResolvedValue(detail);
      await renderHome(readyHome);
      expect(getCourse).toHaveBeenCalledWith('learner-token', 'HSK2_TEXTBOOK');
      const block = within(
        screen.getByRole('region', { name: 'Giáo trình HSK chuẩn 2.0' }),
      );
      expect(block.getByText('Khoá đang học')).toBeInTheDocument();
      expect(block.getByRole('link', { name: 'Đổi khoá' })).toHaveAttribute(
        'href',
        '/learn/courses',
      );
      const links = block.getAllByRole('link', { name: /Số đếm và tuổi/ });
      expect(links.map((link) => link.getAttribute('href'))).toEqual([
        '/learn/lessons/32',
        '/learn/lessons/32',
      ]);
      expect(links[0]).toHaveTextContent('Cấp 1 · Bài 5 · đã học 40%');
      expect(links[1]).toHaveTextContent(/^Học tiếp/);
      expect(
        block.getByRole('link', { name: 'Xem lộ trình khoá' }),
      ).toHaveAttribute('href', '/learn/courses/HSK2_TEXTBOOK');
      expect(block.getByRole('progressbar')).toHaveAttribute(
        'aria-valuenow',
        '3',
      );
      expect(block.getByText('汉')).toHaveAttribute('aria-hidden', 'true');
      // PO 24/11: no XP on Home.
      expect(screen.queryByText(/XP/)).toBeNull();
    });

    it('keeps one "Học tiếp" entry: the course block replaces the continue card (C3b-UI2)', async () => {
      vi.mocked(getCourses).mockResolvedValue([summary]);
      vi.mocked(getCourse).mockResolvedValue(detail);
      const { container } = await renderHome({
        ...readyHome,
        // A topic pick from /learning/home that is not this course's lesson.
        continueLesson: lesson,
        currentCourse: {
          code: 'HSK2_TEXTBOOK',
          title: 'Giáo trình HSK chuẩn 2.0',
          kind: 'textbook',
          progress: { completedLessons: 4, totalLessons: 134 },
          nextLesson: {
            lessonId: 31,
            title: 'Gia đình',
            slug: 'gia-dinh',
            position: 4,
            completionPercent: 0,
          },
        },
      });
      expect(container.querySelector('.home-lesson')).toBeNull();
      expect(
        screen.queryByRole('heading', { name: 'Tiếp tục học' }),
      ).toBeNull();
      const ctas = screen.getAllByRole('link', { name: /^Học tiếp/ });
      expect(ctas).toHaveLength(1);
      // /learning/home decides the lesson; the unit comes from the course.
      expect(ctas[0]).toHaveAttribute('href', '/learn/lessons/31');
      const next = container.querySelector('a.crs-home__next');
      expect(next).toHaveAttribute('href', '/learn/lessons/31');
      expect(next).toHaveTextContent('Cấp 1 · Bài 4');
    });

    it('lists a followed course in "Khoá đang theo" (web)', async () => {
      const followed = {
        ...other,
        progress: { completedLessons: 27, totalLessons: 84 },
      };
      const notFollowed = { ...other, code: 'E2E', enrolled: false };
      vi.mocked(getCourses).mockResolvedValue([followed, notFollowed, summary]);
      vi.mocked(getCourse).mockResolvedValue(detail);
      await renderHome(readyHome);
      const card = within(
        screen.getByRole('region', { name: 'Khoá đang theo' }),
      );
      expect(
        card.getByText(/Chủ đề HSK 3.0 · 27\/84 bài ·/),
      ).toBeInTheDocument();
      expect(card.getByRole('link', { name: 'Xem' })).toHaveAttribute(
        'href',
        '/learn/courses',
      );
    });

    it('has no "Khoá đang theo" card without another followed course', async () => {
      vi.mocked(getCourses).mockResolvedValue([
        { ...other, enrolled: false },
        summary,
      ]);
      vi.mocked(getCourse).mockResolvedValue(detail);
      await renderHome(readyHome);
      expect(
        screen.queryByRole('region', { name: 'Khoá đang theo' }),
      ).toBeNull();
    });

    it('keeps Home without the block when the course read fails', async () => {
      vi.mocked(getCourses).mockRejectedValue(backendError(503));
      await renderHome(readyHome);
      expect(screen.queryByText('Khoá đang học')).toBeNull();
      expect(screen.getByRole('heading', { name: 'Khám phá' })).toBeVisible();
    });

    it('sends the learner to sign-in when the course read is refused', async () => {
      vi.mocked(getLearningHome).mockResolvedValue(readyHome);
      vi.mocked(getCourses).mockRejectedValue(backendError(401));
      await expect(LearnerHomePage()).rejects.toThrow('NEXT_REDIRECT:/sign-in');
    });
  });
});
