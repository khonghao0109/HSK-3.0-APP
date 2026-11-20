import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import type { LessonActivity } from '@/features/learner-lesson/lesson-activity-contract';
import {
  getLessonActivity,
  getLessonTopicActivity,
  getLessonWords,
} from '@/features/learner-lesson/lesson-activity-service';
import type { LessonTopicActivity } from '@/features/learner-lesson/lesson-topic-contract';
import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';
import { getOnboardingStatus } from '@/features/onboarding/onboarding-service';

import LessonGrammarPage from './page';

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
vi.mock('@/features/learner-lesson/lesson-activity-service', () => ({
  getLessonActivity: vi.fn(),
  getLessonTopicActivity: vi.fn(),
  getLessonWords: vi.fn(),
  getUnitWordDetail: vi.fn(),
}));
vi.mock('@/features/onboarding/onboarding-service', () => ({
  getOnboardingStatus: vi.fn(),
  getCurrentGoal: vi.fn(),
}));

const grammarPoint = (title: string, zh: string) => ({
  type: 'grammar_point',
  title,
  formula: [{ role: 'key', zh, vi: 'Từ hỏi' }],
  explanation: `Dùng ${zh}.`,
  examples: [
    { hanzi: `有${zh}个？`, pinyin: 'yǒu', vi: 'có mấy', highlight: zh },
  ],
});

const topics: LessonTopicActivity['topics'] = [
  {
    id: 11,
    title: 'Thành viên',
    subtitle: null,
    type: 'vocabulary',
    content: [],
    orderIndex: 1,
    progress: { status: 'done' },
  },
  {
    id: 12,
    title: 'Câu hỏi',
    subtitle: null,
    type: 'grammar',
    content: [
      grammarPoint('Hỏi với 几', '几'),
      grammarPoint('Câu với 是', '是'),
    ],
    orderIndex: 2,
    progress: { status: 'not_started' },
  },
  {
    id: 13,
    title: 'Nhà bạn có mấy người?',
    subtitle: 'Đọc hội thoại giữa An và Bình.',
    type: 'key_text',
    content: [
      {
        type: 'dialogue',
        lines: [
          { speaker: 'An', hanzi: '你好！', pinyin: 'Nǐ hǎo!', vi: 'Chào!' },
          { speaker: 'Bình', hanzi: '你好！', pinyin: 'Nǐ hǎo!', vi: 'Chào!' },
        ],
      },
    ],
    orderIndex: 3,
    progress: { status: 'not_started' },
  },
  {
    id: 14,
    title: 'Cũ',
    subtitle: null,
    type: 'grammar',
    content: [{ type: 'text', value: 'Chủ ngữ + 是.' }],
    orderIndex: 4,
    progress: { status: 'not_started' },
  },
];

const topicActivity: LessonTopicActivity = {
  lesson: { id: 5, title: 'Gia đình' },
  level: { code: 'HSK1' },
  state: 'current',
  topics,
};

const activity: LessonActivity = {
  lesson: { id: 5, title: 'Gia đình', description: null, coverImage: null },
  progress: { completionPercent: 0, status: 'learning', score: null },
  level: { id: 1, code: 'HSK1', name: 'HSK 1' },
  position: 2,
  state: 'current',
  topics: topics.map((topic) => ({
    id: topic.id,
    title: topic.title,
    subtitle: topic.subtitle,
    type: topic.type,
    orderIndex: topic.orderIndex,
    progress: {
      status: topic.progress.status,
      completionPercent: topic.progress.status === 'done' ? 100 : 0,
    },
    exercises: [],
  })),
  standaloneExercises: [],
  sections: {
    vocabulary: { wordCount: 0, topicCount: 1, topicsDone: 1 },
    grammar: { topicCount: 3, topicsDone: 0 },
    practice: { exerciseCount: 0, attempted: 0 },
  },
};

beforeEach(() => {
  vi.mocked(getServerLearnerSession).mockResolvedValue({
    state: 'learner',
    token: 't',
  } as Awaited<ReturnType<typeof getServerLearnerSession>>);
  vi.mocked(getOnboardingStatus).mockResolvedValue({
    hasActiveGoal: true,
    hasActiveLearningPlan: true,
    hasUsableLearningPlan: true,
    hasCompletedPlacement: false,
    nextStep: 'ready',
  });
  vi.mocked(getLessonActivity).mockResolvedValue(activity);
  vi.mocked(getLessonTopicActivity).mockResolvedValue(topicActivity);
  vi.mocked(getLessonWords).mockResolvedValue({ words: [] });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200 })),
  );
});
afterEach(() => vi.unstubAllGlobals());

const open = async (unit?: string) =>
  LessonGrammarPage({
    params: Promise.resolve({ id: '5' }),
    searchParams: Promise.resolve(unit === undefined ? {} : { unit }),
  });
const show = (element: React.ReactElement) =>
  render(<LearnerToastProvider>{element}</LearnerToastProvider>);

describe('Ngữ pháp and Bài khoá units (Pha D)', () => {
  it('opens a grammar unit as cards, and its result leads to the next unit', async () => {
    show(await open('12'));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Ngữ pháp · Gia đình',
    );
    expect(screen.getByText('Điểm 1 trên 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Đã hiểu' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Đã hiểu' }));
    });
    expect(screen.getByRole('link', { name: 'Đơn vị tiếp' })).toHaveAttribute(
      'href',
      '/learn/lessons/5/grammar?unit=13',
    );
  });

  it('opens a key_text unit as the conversation', async () => {
    show(await open('13'));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Bài khoá · Gia đình',
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Nhà bạn có mấy người?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Đọc hội thoại giữa An và Bình.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'An' }).textContent).toBe('A');
  });

  it('opens the Ngữ pháp page for a topic with only text blocks (old content)', async () => {
    await expect(open('14')).rejects.toThrow(
      'NEXT_REDIRECT:/learn/lessons/5/grammar',
    );
  });

  it.each([
    ['a vocabulary topic', '11'],
    ['an unknown topic', '99'],
    ['a malformed id', 'abc'],
  ])('sends %s back to the lesson page', async (_name, unit) => {
    await expect(open(unit)).rejects.toThrow('NEXT_REDIRECT:/learn/lessons/5');
  });

  it('sends a locked lesson back to the lesson page (Q40)', async () => {
    vi.mocked(getLessonActivity).mockResolvedValue({
      ...activity,
      state: 'locked',
    });
    await expect(open('12')).rejects.toThrow('NEXT_REDIRECT:/learn/lessons/5');
  });

  it('keeps the old Ngữ pháp page without ?unit', async () => {
    show(await open());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Ngữ pháp · Gia đình',
    );
    expect(screen.getByText('Chủ ngữ + 是.')).toBeInTheDocument();
  });
});
