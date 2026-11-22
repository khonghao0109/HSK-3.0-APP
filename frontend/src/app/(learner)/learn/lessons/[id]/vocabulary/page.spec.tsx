import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import type { LessonActivity } from '@/features/learner-lesson/lesson-activity-contract';
import {
  getLessonActivity,
  getLessonTopicActivity,
  getLessonWords,
  getUnitWordDetail,
} from '@/features/learner-lesson/lesson-activity-service';
import type {
  LessonTopicActivity,
  LessonWords,
  UnitWordDetail,
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
  getLessonActivity: vi.fn(),
  getLessonTopicActivity: vi.fn(),
  getLessonWords: vi.fn(),
  getUnitWordDetail: vi.fn(),
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

  it('shows grammar point cards and dialogues read-only on the old grammar page (Pha D, TL 6)', async () => {
    vi.mocked(getLessonTopicActivity).mockResolvedValue({
      ...activity,
      topics: [
        {
          ...activity.topics[2]!,
          content: [
            {
              type: 'grammar_point',
              title: 'Câu với 是',
              formula: [{ role: 'subj', zh: '主语', vi: 'Chủ ngữ' }],
              explanation: 'Chủ ngữ + 是 + danh từ.',
              examples: [
                {
                  hanzi: '我是学生。',
                  pinyin: 'Wǒ shì xuésheng.',
                  vi: 'Tôi là học sinh.',
                  highlight: '是',
                },
              ],
            },
            // Saved before the CMS rule: skipped, the page still renders.
            { type: 'grammar_point', title: 'Hỏng' },
          ],
        },
        {
          ...activity.topics[0]!,
          content: [
            {
              type: 'dialogue',
              lines: [
                {
                  speaker: 'An',
                  hanzi: '你好！',
                  pinyin: 'Nǐ hǎo!',
                  vi: 'Chào bạn!',
                },
              ],
            },
          ],
        },
      ],
    });
    const { container } = renderPage(
      await LessonGrammarPage({ params: Promise.resolve({ id: '5' }) }),
    );
    expect(
      screen.getByRole('heading', { level: 3, name: 'Câu với 是' }),
    ).toBeInTheDocument();
    expect(container.querySelector('mark.lu-hl')?.textContent).toBe('是');
    expect(screen.queryByText('Hỏng')).toBeNull();
    expect(screen.getByLabelText('An').textContent).toBe('A');
    expect(screen.getByText('Chào bạn!')).toBeInTheDocument();
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

const unitTopic = (
  id: number,
  type: string,
  title: string,
  status: 'not_started' | 'done' = 'not_started',
): LessonActivity['topics'][number] => ({
  id,
  title,
  subtitle: null,
  type,
  orderIndex: id,
  progress: { status, completionPercent: status === 'done' ? 100 : 0 },
  exercises: [],
});

const unitActivity: LessonActivity = {
  lesson: { id: 5, title: 'Gia đình', description: null, coverImage: null },
  progress: { completionPercent: 0, status: 'learning', score: null },
  level: { id: 1, code: 'HSK1', name: 'HSK 1' },
  position: 2,
  state: 'current',
  topics: [
    unitTopic(10, 'vocabulary', 'Thành viên', 'done'),
    unitTopic(11, 'vocabulary', 'Gia đình'),
    unitTopic(12, 'grammar', 'Câu với 几'),
  ],
  standaloneExercises: [],
  sections: {
    vocabulary: { wordCount: 3, topicCount: 2, topicsDone: 1 },
    grammar: { topicCount: 1, topicsDone: 0 },
    practice: { exerciseCount: 0, attempted: 0 },
  },
};

const lessonWord = (
  id: number,
  topicId: number,
  hanzi: string,
  tone: string,
  vi: string,
) => ({
  id,
  topicId,
  hanzi,
  pinyin: tone,
  pinyinTone: tone,
  meanings: [{ vi, en: null }],
  image: null,
});

const unitWords: LessonWords = {
  words: [
    lessonWord(1, 10, '爸爸', 'ba4 ba5', 'bố'),
    lessonWord(2, 11, '家', 'jia1', 'nhà; gia đình'),
    lessonWord(3, 11, '有', 'you3', 'có'),
  ],
};

const detail = (extra: Partial<UnitWordDetail> = {}): UnitWordDetail => ({
  example: null,
  meanings: [],
  examples: [],
  ...extra,
});

describe('Từ vựng unit flow (N3)', () => {
  beforeEach(() => {
    vi.mocked(getLessonActivity).mockResolvedValue(unitActivity);
    vi.mocked(getLessonWords).mockResolvedValue(unitWords);
    vi.mocked(getUnitWordDetail).mockClear();
    vi.mocked(getUnitWordDetail).mockImplementation(async (_token, id) =>
      id === 2
        ? detail({
            meanings: [{ vi: 'nhà', partOfSpeech: 'danh từ' }],
            examples: [
              {
                hanzi: '我家有四口人。',
                pinyin: 'wǒ jiā yǒu sì kǒu rén.',
                vi: 'Nhà tôi có bốn người.',
              },
            ],
          })
        : detail(),
    );
  });

  const open = async (unit: string) =>
    LessonVocabularyPage({
      params: Promise.resolve({ id: '5' }),
      searchParams: Promise.resolve({ unit }),
    });

  it('titles the unit screen with the unit label and the lesson title (Pha F)', async () => {
    renderPage(await open('10'));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Từ vựng 1 · Gia đình',
    );
  });

  it('opens the words of that topic only, in API order, as a step flow', async () => {
    renderPage(await open('11'));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Từ vựng 2 · Gia đình',
    );
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('家');
    expect(screen.getByText('danh từ')).toBeInTheDocument();
    // 家: card, example, quiz; 有: card, quiz; G2c: sắp xếp câu của 家.
    expect(screen.getByLabelText('Bước 1 trên 6')).toBeInTheDocument();
    // G2c (TL duyệt 22/11): every lesson word, for the fill distractors.
    expect(
      vi.mocked(getUnitWordDetail).mock.calls.map((call) => call[1]),
    ).toEqual([1, 2, 3]);
    expect(screen.queryByText('爸爸')).toBeNull();
  });

  it.each([
    ['a grammar topic', '12'],
    ['an unknown topic', '99'],
    ['a malformed id', 'abc'],
  ])('sends %s back to the lesson page', async (_name, unit) => {
    await expect(open(unit)).rejects.toThrow('NEXT_REDIRECT:/learn/lessons/5');
  });

  it('opens the word list page for a vocabulary topic without words (old lessons)', async () => {
    vi.mocked(getLessonWords).mockResolvedValue({
      words: unitWords.words.map((word) => ({ ...word, topicId: null })),
    });
    await expect(open('11')).rejects.toThrow(
      'NEXT_REDIRECT:/learn/lessons/5/vocabulary',
    );
  });

  it('sends a locked lesson back to the lesson page (Q40)', async () => {
    vi.mocked(getLessonActivity).mockResolvedValue({
      ...unitActivity,
      state: 'locked',
    });
    await expect(open('11')).rejects.toThrow('NEXT_REDIRECT:/learn/lessons/5');
    expect(getUnitWordDetail).not.toHaveBeenCalled();
  });
});
