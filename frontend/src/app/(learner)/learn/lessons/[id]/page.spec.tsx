import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notFound, redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import type { LessonActivity } from '@/features/learner-lesson/lesson-activity-contract';
import {
  getLessonActivity,
  getLessonWords,
} from '@/features/learner-lesson/lesson-activity-service';
import type { LessonWords } from '@/features/learner-lesson/lesson-topic-contract';
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
  getLessonWords: vi.fn(),
}));
vi.mock('@/features/onboarding/onboarding-service', () => ({
  getOnboardingStatus: vi.fn(),
  getCurrentGoal: vi.fn(),
}));

type Topic = LessonActivity['topics'][number];
const attempt = { attemptId: 1 };
const unit = (
  id: number,
  type: string,
  title: string,
  progress: Topic['progress'] = { status: 'not_started', completionPercent: 0 },
  exercises: Topic['exercises'] = [],
): Topic => ({
  id,
  title,
  subtitle: null,
  type,
  orderIndex: id,
  progress,
  exercises,
});
const DONE = { status: 'done', completionPercent: 100 } as const;

const current: LessonActivity = {
  lesson: {
    id: 5,
    title: 'Chào hỏi',
    description: 'Lời chào trong ngày.',
    coverImage: null,
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
  topics: [
    unit(11, 'vocabulary', 'Gia đình', DONE, [{ latestAttempt: attempt }]),
    unit(12, 'vocabulary', 'Số đếm', {
      status: 'learning',
      completionPercent: 50,
    }),
    unit(13, 'grammar', 'Câu hỏi số lượng với 几'),
    unit(14, 'key_text', 'Hội thoại: Nhà bạn có mấy người?'),
    unit(15, 'quiz', 'Kiểm tra cuối bài', undefined, [{ latestAttempt: null }]),
  ],
  standaloneExercises: [{ latestAttempt: null }],
};

const words: LessonWords['words'] = [
  ['爸爸', 11],
  ['妈妈', 11],
  ['哥哥', 11],
  ['姐姐', 11],
  ['家', 12],
  ['有', 12],
  ['几', 12],
  ['口', 12],
].map(([hanzi, topicId], index) => ({
  id: index + 1,
  topicId: topicId as number,
  hanzi: hanzi as string,
  pinyin: '',
  pinyinTone: null,
  meanings: [],
  image: null,
}));

/** Every unit before Kiểm tra done, so Kiểm tra opens (N2). */
const finished: LessonActivity = {
  ...current,
  topics: current.topics.map((topic) =>
    topic.type === 'quiz' ? topic : { ...topic, progress: DONE },
  ),
};

const locked: LessonActivity = {
  lesson: { id: 6, title: 'Gia đình', description: null, coverImage: null },
  progress: { completionPercent: 0, status: 'not_started', score: null },
  level: { id: 1, code: 'HSK1', name: 'HSK 1' },
  position: 2,
  state: 'locked',
  sections: {
    vocabulary: { wordCount: 3, topicCount: 1, topicsDone: 0 },
    grammar: { topicCount: 1, topicsDone: 0 },
    practice: { exerciseCount: 0, attempted: 0 },
  },
  topics: [
    unit(21, 'vocabulary', 'Thành viên'),
    unit(22, 'grammar', 'Câu với 有'),
  ],
  standaloneExercises: [],
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

async function renderLesson(
  activity: LessonActivity,
  id = '5',
  lessonWords: LessonWords['words'] = words,
) {
  vi.mocked(getLessonActivity).mockResolvedValue(activity);
  vi.mocked(getLessonWords).mockResolvedValue({ words: lessonWords });
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
    vi.mocked(getLessonWords).mockResolvedValue({ words: [] });
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
    expect(getLessonWords).toHaveBeenCalledWith('learner-token', 2147483647);
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
    // M2.10b: one copy in the mobile bar, one on the web hero card.
    const favs = screen.getAllByRole('button', { name: 'Yêu thích bài học' });
    expect(favs).toHaveLength(2);
    for (const fav of favs) expect(fav).not.toHaveAttribute('aria-pressed');
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
    // M2.10b: the mobile hero keeps its bar; the web progress card repeats it.
    const bars = screen.getAllByRole('progressbar', {
      name: 'Tiến độ bài học',
    });
    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      expect(bar).toHaveAttribute('aria-valuenow', '67');
      expect(bar.firstElementChild).toHaveClass('pct-67');
    }
    expect(container.querySelector('.lesson-hero__pct')?.textContent).toBe(
      '67% hoàn thành',
    );
    expect(container.querySelector('.lesson-prog__pct')?.textContent).toBe(
      '67% hoàn thành',
    );
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('renders one unit row per topic with badges, meta and spoken names (L-units)', async () => {
    const { container } = await renderLesson(current);
    expect(container.querySelector('#lesson-content-title')?.textContent).toBe(
      'Đơn vị học',
    );
    const rows = Array.from(container.querySelectorAll('.lu-rows .lu-row'));
    expect(rows.map((row) => row.getAttribute('class'))).toEqual([
      'lu-row is-done',
      'lu-row',
      'lu-row',
      'lu-row',
      'lu-row is-locked',
    ]);
    expect(rows.map(spokenName)).toEqual([
      'Từ vựng 1, 爸爸 · 妈妈 · 哥哥 · 姐姐, đã học xong',
      'Từ vựng 2, 家 · 有 · 几 · 口, đã học 50%',
      'Ngữ pháp, Câu hỏi số lượng với 几, đã học 0%',
      'Bài khoá, Hội thoại: Nhà bạn có mấy người?, đã học 0%',
      'Kiểm tra, Mở khi xong các đơn vị trên, đang khoá',
    ]);
    expect(
      rows.map((row) => {
        const badge = row.querySelector('.lu-badge');
        return [badge?.getAttribute('class'), badge?.textContent];
      }),
    ).toEqual([
      ['lu-badge is-jade', '词'],
      ['lu-badge is-jade', '词'],
      ['lu-badge is-violet', '语'],
      ['lu-badge is-amber', '文'],
      ['lu-badge is-mute', '测'],
    ]);
    expect(
      rows.map((row) =>
        row.querySelector('.lu-row__meta')?.getAttribute('lang'),
      ),
    ).toEqual(['zh-Hans', 'zh-Hans', null, null, null]);
    expect(rows[0]?.querySelector('.lu-bar')).toBeNull();
    expect(rows[1]?.querySelector('.lu-bar > span')).toHaveClass('pct-50');
    expect(rows[2]?.querySelector('.lu-bar > span')).toHaveClass('pct-0');
    expect(rows[4]?.querySelector('.lu-bar')).toBeNull();
    expect(rows.map((row) => row.tagName)).toEqual(['A', 'A', 'A', 'A', 'DIV']);
    for (const row of rows) {
      expect(row.querySelector('.lu-badge')).toHaveAttribute(
        'aria-hidden',
        'true',
      );
    }
    expect(rows[4]).toHaveAttribute('aria-disabled', 'true');
    expect(rows[4]?.querySelector('.lu-row__lock')).not.toBeNull();
    expect(container.querySelector('.lesson-rows, .lrow')).toBeNull();
  });

  it('labels a finished unit with its mobile and web state (F11)', async () => {
    const { container } = await renderLesson(current);
    const rows = Array.from(container.querySelectorAll('.lu-rows .lu-row'));
    const done = rows.filter((row) => row.classList.contains('is-done'));
    expect(done).toHaveLength(1);
    const finishedRow = done[0];
    if (!finishedRow) throw new Error('missing finished unit');

    const mobile = finishedRow.querySelector('.lu-row__state.m-only');
    const web = finishedRow.querySelector('.lu-row__state.w-only');
    expect(mobile?.textContent).toBe('Xong');
    expect(web?.textContent).toBe('Đã học xong');
    for (const state of [mobile, web]) {
      expect(state).toHaveAttribute('aria-hidden', 'true');
    }
    expect(
      within(finishedRow as HTMLElement).getByText(', đã học xong'),
    ).toHaveClass('sr-only');
    for (const row of rows.filter((candidate) => candidate !== finishedRow)) {
      expect(row).not.toHaveClass('is-done');
      expect(row.querySelector('.lu-row__state.m-only')).toBeNull();
    }
  });

  it('keeps Kiểm tra an inert locked row until earlier units are done (N2)', async () => {
    const { container } = await renderLesson(current);
    const quiz = Array.from(container.querySelectorAll('.lu-row')).find(
      (row) => row.querySelector('.lu-row__title')?.textContent === 'Kiểm tra',
    );
    if (!quiz) throw new Error('missing unit Kiểm tra');
    expect(quiz.tagName).toBe('DIV');
    expect(container.querySelector('.lu-rows a[href$="/practice"]')).toBeNull();
    fireEvent.click(quiz);
    expect(screen.queryByText('Hoàn thành bài trước để mở khoá.')).toBeNull();
  });

  it('names the locked Kiểm tra row with the reason it is locked (Pha B debt 5b)', async () => {
    await renderLesson(current);
    const quiz = screen.getByRole('link', {
      // jsdom drops the space of the sr-only ", "; Chrome's name is checked
      // by the e2e aria snapshot.
      name: /^Kiểm tra, ?Mở khi xong các đơn vị trên, đang khoá$/,
    });
    expect(quiz).toHaveAttribute('aria-disabled', 'true');
    expect(quiz).not.toHaveAttribute('href');
  });

  it('links Kiểm tra to the player once earlier units are done (N1, Q45)', async () => {
    const { container } = await renderLesson(finished);
    const quiz = Array.from(container.querySelectorAll('.lu-row')).find(
      (row) => row.querySelector('.lu-row__title')?.textContent === 'Kiểm tra',
    );
    expect(quiz?.tagName).toBe('A');
    expect(quiz).toHaveAttribute('href', '/learn/lessons/5/practice');
    expect(quiz?.querySelector('.lu-badge')).toHaveClass('is-blue');
    expect(spokenName(quiz as Element)).toBe('Kiểm tra, 2 bài tập, đã học 0%');
    if (quiz) fireEvent.click(quiz);
    expect(screen.queryByText('Tính năng sắp ra mắt.')).toBeNull();
  });

  it.each([
    ['Từ vựng 1', 'vocabulary?unit=11'],
    ['Từ vựng 2', 'vocabulary?unit=12'],
    ['Ngữ pháp', 'grammar'],
    ['Bài khoá', 'grammar'],
  ])(
    'links unit %s to its page, a vocabulary unit to its step flow (N3)',
    async (title, slug) => {
      const { container } = await renderLesson(current);
      const row = Array.from(container.querySelectorAll('.lu-row')).find(
        (candidate) =>
          candidate.querySelector('.lu-row__title')?.textContent === title,
      );
      expect(row?.tagName).toBe('A');
      expect(row).toHaveAttribute('href', `/learn/lessons/5/${slug}`);
    },
  );

  it('shows a lesson without topics as its Kiểm tra unit only (fallback)', async () => {
    const { container } = await renderLesson(
      {
        ...current,
        topics: [],
        standaloneExercises: [{ latestAttempt: null }],
      },
      '5',
      [],
    );
    const rows = Array.from(container.querySelectorAll('.lu-rows .lu-row'));
    expect(rows.map(spokenName)).toEqual(['Kiểm tra, 1 bài tập, đã học 0%']);
    expect(rows[0]).toHaveAttribute('href', '/learn/lessons/5/practice');
  });

  it('links the CTA to the player and toasts the heart (Q33, Q45)', async () => {
    const { container } = await renderLesson(current);
    expect(screen.queryByRole('button', { name: 'Tiếp tục học' })).toBeNull();
    // M2.10b: mobile sheet CTA + web progress-card CTA, same target.
    const ctas = screen.getAllByRole('link', { name: 'Tiếp tục học' });
    expect(ctas).toHaveLength(2);
    for (const cta of ctas) {
      expect(cta).toHaveClass('lesson-cta');
      expect(cta).toHaveAttribute('href', '/learn/lessons/5/practice');
      expect(cta).not.toHaveAttribute('aria-disabled');
    }
    const bar = container.querySelector('.m02-bar');
    if (!bar) throw new Error('missing mobile bar');
    fireEvent.click(
      within(bar as HTMLElement).getByRole('button', {
        name: 'Yêu thích bài học',
      }),
    );
    expect(
      within(screen.getByRole('status')).getAllByText('Tính năng sắp ra mắt.'),
    ).toHaveLength(1);
  });

  it('keeps unit Kiểm tra of a locked lesson a lock toast, not a link (Q44)', async () => {
    const { container } = await renderLesson(
      { ...locked, standaloneExercises: [{ latestAttempt: null }] },
      '6',
    );
    const row = Array.from(container.querySelectorAll('.lu-row')).find(
      (candidate) =>
        candidate.querySelector('.lu-row__title')?.textContent === 'Kiểm tra',
    );
    if (!row) throw new Error('missing unit Kiểm tra');
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

  it('hides a missing description (Q39) and Kiểm tra without exercises (Q35)', async () => {
    const { container } = await renderLesson(locked, '6', []);
    expect(container.querySelector('.lesson-hero__desc')).toBeNull();
    expect(
      Array.from(container.querySelectorAll('.lu-row__title')).map(
        (title) => title.textContent,
      ),
    ).toEqual(['Từ vựng 1', 'Ngữ pháp']);
  });

  it('renders a locked lesson with lock rows and a grey CTA (Q40, Q44)', async () => {
    const { container } = await renderLesson(locked, '6', []);
    const rows = Array.from(container.querySelectorAll('.lu-rows .lu-row'));
    expect(rows.map(spokenName)).toEqual([
      'Từ vựng 1, Thành viên, đang khoá',
      'Ngữ pháp, Câu với 有, đang khoá',
    ]);
    for (const row of rows) {
      expect(row).toHaveClass('is-locked');
      expect(row).toHaveAttribute('aria-disabled', 'true');
      expect(row).not.toHaveAttribute('disabled');
      expect(row.querySelector('.lu-row__lock')).not.toBeNull();
      expect(row.querySelector('.lu-bar')).toBeNull();
    }
    const ctas = screen.getAllByRole('button', { name: 'Tiếp tục học' });
    // M2.10b: mobile sheet CTA + web progress-card CTA, both locked.
    expect(ctas).toHaveLength(2);
    for (const cta of ctas) {
      expect(cta).toHaveAttribute('aria-disabled', 'true');
      expect(cta).not.toHaveAttribute('disabled');
    }
    const cta = ctas[0];
    if (!cta) throw new Error('missing CTA');
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
    const bar = container.querySelector('.m02-bar');
    if (!bar) throw new Error('missing mobile bar');
    fireEvent.click(
      within(bar as HTMLElement).getByRole('button', {
        name: 'Yêu thích bài học',
      }),
    );
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
    // M2.10b: the page now carries the web top bar, whose bell needs the
    // toast provider.
    const { container } = render(
      <LearnerToastProvider>
        <LessonNotFound />
      </LearnerToastProvider>,
    );
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
