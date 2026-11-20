import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import {
  getLessonTopicActivity,
  getLessonWords,
} from '@/features/learner-lesson/lesson-activity-service';
import type {
  LessonTopicActivity,
  LessonWords,
} from '@/features/learner-lesson/lesson-topic-contract';
import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';
import { getOnboardingStatus } from '@/features/onboarding/onboarding-service';

import LessonGrammarPage from '../grammar/page';
import LessonVocabularyPage, { metadata } from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/features/learner-auth/server-learner-session', () => ({
  getServerLearnerSession: vi.fn(),
}));
vi.mock('@/features/learner-lesson/lesson-activity-service', () => ({
  getLessonTopicActivity: vi.fn(),
  getLessonWords: vi.fn(),
}));
vi.mock('@/features/onboarding/onboarding-service', () => ({
  getOnboardingStatus: vi.fn(),
  getCurrentGoal: vi.fn(),
}));

const activity: LessonTopicActivity = {
  lesson: { id: 5, title: 'Chào hỏi' },
  level: { code: 'HSK1' },
  state: 'current',
  topics: [
    {
      id: 30,
      title: 'Đoạn hội thoại mẫu',
      subtitle: null,
      type: 'key_text',
      content: [{ type: 'text', value: 'A: 你好！' }],
      orderIndex: 3,
      progress: { status: 'not_started' },
    },
    {
      id: 10,
      title: 'Từ vựng: chào hỏi',
      subtitle: 'Đọc to từng từ',
      type: 'vocabulary',
      content: [
        { type: 'text', value: 'Bài 1 gồm 2 từ.' },
        { type: 'vocabulary_list', value: 'lesson_words' },
        { type: 'image', url: '/x.png' },
      ],
      orderIndex: 1,
      progress: { status: 'done' },
    },
    {
      id: 20,
      title: 'Ngữ pháp: 是',
      subtitle: null,
      type: 'grammar',
      content: [{ type: 'text', value: 'Chủ ngữ + 是 + danh từ.' }],
      orderIndex: 2,
      progress: { status: 'learning' },
    },
  ],
};

const words: LessonWords = {
  words: [
    {
      id: 1,
      topicId: null,
      hanzi: '你',
      pinyin: 'ni',
      pinyinTone: 'ni3',
      meanings: [
        { vi: null, en: 'you' },
        { vi: 'bạn', en: null },
      ],
      image: null,
    },
    {
      id: 2,
      topicId: null,
      hanzi: '好',
      pinyin: 'hao',
      pinyinTone: 'hao3',
      meanings: [{ vi: null, en: 'good' }],
      image: null,
    },
  ],
};

function renderPage(element: React.ReactElement) {
  return render(<LearnerToastProvider>{element}</LearnerToastProvider>);
}

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
  vi.mocked(getLessonTopicActivity).mockResolvedValue(activity);
  vi.mocked(getLessonWords).mockResolvedValue(words);
});

describe('lesson topic pages (M2.5f, Q175)', () => {
  it('renders vocabulary text and the word list with Vietnamese meanings only', async () => {
    expect(metadata.title).toBe('Từ vựng');
    renderPage(
      await LessonVocabularyPage({ params: Promise.resolve({ id: '5' }) }),
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Từ vựng · Chào hỏi' }),
    ).toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'Từ vựng: chào hỏi' });
    expect(within(card).getByText('Bài 1 gồm 2 từ.')).toBeInTheDocument();
    expect(within(card).getByText('Đọc to từng từ')).toBeInTheDocument();
    const items = within(card).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('你nǐbạn');
    expect(items[1]).toHaveTextContent('好hǎoChưa có nghĩa tiếng Việt');
    expect(within(items[0] as HTMLElement).getByRole('link')).toHaveAttribute(
      'href',
      '/learn/dictionary/1',
    );
    expect(card).not.toHaveTextContent('good');
    expect(within(card).getByText('Đã học xong')).toBeInTheDocument();
    expect(screen.queryByText('Chủ ngữ + 是 + danh từ.')).toBeNull();
  });

  it('renders grammar then key_text topics with a mark-learned button', async () => {
    renderPage(
      await LessonGrammarPage({ params: Promise.resolve({ id: '5' }) }),
    );

    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual(['Ngữ pháp: 是', 'Đoạn hội thoại mẫu']);
    expect(screen.getByText('A: 你好！')).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'Đánh dấu đã học' }),
    ).toHaveLength(2);
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('sends a locked lesson back to the lesson page (Q40)', async () => {
    vi.mocked(getLessonTopicActivity).mockResolvedValue({
      ...activity,
      state: 'locked',
    });
    await expect(
      LessonVocabularyPage({ params: Promise.resolve({ id: '5' }) }),
    ).rejects.toThrow('NEXT_REDIRECT:/learn/lessons/5');
  });
});
