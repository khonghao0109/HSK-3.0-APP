import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notFound, redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import { getExamAttempt } from '@/features/learner-exam/exam-attempt-service';
import type {
  ExamReviewQuestionParsed,
  ExamReviewViewParsed,
} from '@/features/learner-exam/exam-contract';
import { getExamReview } from '@/features/learner-exam/exam-review-service';
import { BackendRequestError } from '@/lib/api/api-error';

import LearnerExamReviewPage, { metadata } from './page';

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
vi.mock('@/features/learner-exam/exam-review-service', () => ({
  getExamReview: vi.fn(),
}));
vi.mock('@/features/learner-exam/exam-attempt-service', () => ({
  getExamAttempt: vi.fn(),
}));
vi.mock('@/features/learner-exam/exam-review-media', () => ({
  ExamReviewMedia: ({ mediaId }: { mediaId: number }) => (
    <span data-testid={`media-${String(mediaId)}`} />
  ),
}));

function question(
  overrides: Partial<ExamReviewQuestionParsed> = {},
): ExamReviewQuestionParsed {
  return {
    key: 'q1',
    orderIndex: 1,
    type: 'mcq',
    skill: 'reading',
    sectionKey: 's1',
    groupKey: 's1-g1',
    content: 'Câu trắc nghiệm số một.',
    answers: {
      options: [
        { id: 'a', text: 'Đáp án đúng' },
        { id: 'b', text: 'Đáp án sai' },
      ],
    },
    learnerAnswer: { choice: 'a' },
    correctAnswer: { optionId: 'a' },
    explanation: 'Vì A đúng.',
    isCorrect: true,
    isFlagged: false,
    groupMedia: { audio: null, image: null },
    audio: null,
    image: null,
    ...overrides,
  };
}

function review(
  overrides: Partial<ExamReviewViewParsed> = {},
): ExamReviewViewParsed {
  return {
    attemptId: 41,
    status: 'submitted',
    testTitle: 'Đề thi thử HSK 3',
    startedAt: '2025-05-19T01:28:18.000Z',
    submittedAt: '2025-05-19T02:00:00.000Z',
    questions: [
      question(),
      question({
        key: 'q2',
        orderIndex: 2,
        content: 'Câu trắc nghiệm số hai.',
        learnerAnswer: { choice: 'b' },
        isCorrect: false,
        isFlagged: true,
      }),
      question({
        key: 'q3',
        orderIndex: 3,
        type: 'true_false',
        content: 'Câu đúng sai.',
        answers: {},
        learnerAnswer: { value: false },
        correctAnswer: { value: true },
        isCorrect: false,
        groupMedia: {
          audio: {
            mediaId: 32,
            kind: 'audio',
            mimeType: 'audio/mpeg',
            durationMs: 12_000,
          },
          image: null,
        },
      }),
      question({
        key: 'q4',
        orderIndex: 4,
        type: 'fill_blank',
        content: 'Câu điền từ.',
        answers: {},
        learnerAnswer: { text: '你好' },
        correctAnswer: { acceptedTexts: ['你好'], caseSensitive: false },
      }),
      question({
        key: 'q5',
        orderIndex: 5,
        type: 'arrange_sentence',
        content: 'Câu sắp xếp.',
        answers: {
          tokens: [
            { id: 't1', text: '我' },
            { id: 't2', text: '想' },
            { id: 't3', text: '买' },
          ],
        },
        learnerAnswer: { order: ['t1', 't2', 't3'] },
        correctAnswer: { tokenIds: ['t1', 't2', 't3'] },
        explanation: null,
        audio: {
          mediaId: 32,
          kind: 'audio',
          mimeType: 'audio/mpeg',
          durationMs: 12_000,
        },
      }),
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

async function renderPage(id = '41', filter?: string, q?: string) {
  return render(
    await LearnerExamReviewPage({
      params: Promise.resolve({ attemptId: id }),
      searchParams: Promise.resolve({
        ...(filter === undefined ? {} : { filter }),
        ...(q === undefined ? {} : { q }),
      }),
    }),
  );
}

describe('LearnerExamReviewPage (M4.5 B2b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'learner',
      token: 'token',
    } as never);
    vi.mocked(getExamReview).mockResolvedValue(review());
    vi.mocked(getExamAttempt).mockResolvedValue({ testId: 7 } as never);
  });

  it('renders the four question types with icon+text status, flag, grouping and media', async () => {
    const { container } = await renderPage();
    expect(metadata.title).toBe('Xem lại bài thi');

    const questionPanels = container.querySelectorAll('.exv-q');
    expect(questionPanels).toHaveLength(5);
    expect(screen.getByText('Đọc · Phần 1')).toBeDefined();
    expect(screen.getByText('Nhóm 1')).toBeDefined();

    // R14: every state has both an icon and a text label.
    const correct = within(questionPanels[0] as HTMLElement);
    expect(correct.getAllByText('Đúng').length).toBeGreaterThanOrEqual(1);
    const wrong = within(questionPanels[1] as HTMLElement);
    expect(wrong.getAllByText('Sai').length).toBeGreaterThanOrEqual(1);
    expect(wrong.getByText('Đánh dấu')).toBeDefined();

    // 4 types: mcq options + true_false / fill_blank / arrange answers.
    expect(correct.getAllByText('Đáp án đúng').length).toBeGreaterThanOrEqual(
      2,
    );
    expect(correct.getByText('Bạn chọn')).toBeDefined();
    expect(wrong.getAllByText('Đáp án đúng').length).toBeGreaterThanOrEqual(1);
    const tf = within(questionPanels[2] as HTMLElement);
    expect(tf.getAllByText('Đúng').length).toBeGreaterThanOrEqual(1);
    expect(tf.getAllByText('Sai').length).toBeGreaterThanOrEqual(1);
    const fill = within(questionPanels[3] as HTMLElement);
    expect(fill.getAllByText('你好').length).toBe(2);
    const arrange = within(questionPanels[4] as HTMLElement);
    expect(arrange.getAllByText('我想买').length).toBeGreaterThan(0);

    // Q158: media refs render through the client island, never inline URLs.
    expect(screen.getByTestId('media-32')).toBeDefined();
    expect(screen.queryByText('/api/v1/media')).toBeNull();

    // Q222: no mistake-book link on this page.
    expect(container.textContent).not.toContain('Sổ lỗi');

    // Q240: grid cells show visible ✓ / ✕ marks alongside question numbers while keeping aria-label.
    const cells = container.querySelectorAll('.exv-cell');
    expect(cells).toHaveLength(5);
    expect(cells[0]?.getAttribute('aria-label')).toBe('Câu 1, Đúng');
    expect(cells[0]?.textContent).toContain('1');
    expect(cells[0]?.textContent).toContain('✓');
    expect(cells[1]?.getAttribute('aria-label')).toBe('Câu 2, Sai, đánh dấu');
    expect(cells[1]?.textContent).toContain('2');
    expect(cells[1]?.textContent).toContain('✕');
  });

  it('filters by tất cả / đúng / sai / đánh dấu through the URL (Q240)', async () => {
    const correctOnly = await renderPage('41', 'correct');
    let panels = correctOnly.container.querySelectorAll('.exv-q');
    expect(panels).toHaveLength(3);
    expect(correctOnly.container.textContent).toContain(
      'Câu trắc nghiệm số một.',
    );
    expect(correctOnly.container.textContent).not.toContain(
      'Câu trắc nghiệm số hai.',
    );

    const wrongOnly = await renderPage('41', 'wrong');
    panels = wrongOnly.container.querySelectorAll('.exv-q');
    expect(panels).toHaveLength(2);
    expect(wrongOnly.container.textContent).not.toContain(
      'Câu trắc nghiệm số một.',
    );
    const wrongLink = wrongOnly.container.querySelector(
      '.exv-filter:not([aria-current]), .exv-filter[aria-current="page"]',
    );
    expect(wrongLink).not.toBeNull();

    const flagged = await renderPage('41', 'flagged');
    panels = flagged.container.querySelectorAll('.exv-q');
    expect(panels).toHaveLength(1);
    expect(flagged.container.textContent).toContain('Câu trắc nghiệm số hai.');

    const all = await renderPage('41', 'nonsense');
    expect(all.container.querySelectorAll('.exv-q')).toHaveLength(5);
  });

  it('shows the empty copy when a filter has no question', async () => {
    vi.mocked(getExamReview).mockResolvedValue(
      review({ questions: [question()] }),
    );
    const { container } = await renderPage('41', 'wrong');
    expect(container.querySelectorAll('.exv-q')).toHaveLength(0);
    expect(container.textContent).toContain('Bạn không có câu sai nào.');
  });

  it('redirects a non-terminal attempt to the taking page (Q167/TL-188)', async () => {
    vi.mocked(getExamReview).mockRejectedValue(
      backendFailure(409, 'EXAM_ATTEMPT_NOT_TERMINAL'),
    );
    await expect(renderPage()).rejects.toThrow(
      'NEXT_REDIRECT:/learn/exam/attempts/41',
    );
    expect(redirect).toHaveBeenCalledWith('/learn/exam/attempts/41');
  });

  it('shows the closed notice with the intro link for an invalidated attempt', async () => {
    vi.mocked(getExamReview).mockRejectedValue(
      backendFailure(409, 'EXAM_ATTEMPT_CLOSED'),
    );
    const { container } = await renderPage();
    expect(container.textContent).toContain('Không xem lại được bài thi');
    const link = screen.getByRole('link', { name: 'Về màn giới thiệu đề' });
    expect(link.getAttribute('href')).toBe('/learn/exam/7');
  });

  it('shows the retry block for an unavailable review and preserves filter and q (Q239)', async () => {
    vi.mocked(getExamReview).mockRejectedValue(
      backendFailure(409, 'EXAM_RESULT_UNAVAILABLE'),
    );
    const first = await renderPage();
    expect(screen.getByRole('alert').textContent).toContain(
      'Chưa tải được bài xem lại',
    );
    expect(
      screen.getByRole('link', { name: 'Thử lại' }).getAttribute('href'),
    ).toBe('/learn/exam/attempts/41/review');
    first.unmount();

    const filteredWithQ = await renderPage('41', 'wrong', '3');
    expect(
      within(filteredWithQ.container)
        .getByRole('link', { name: 'Thử lại' })
        .getAttribute('href'),
    ).toBe('/learn/exam/attempts/41/review?filter=wrong&q=3');
  });

  it('highlights the selected question, renders prev/next links within the filtered list, and drops q on filter links (Q239)', async () => {
    const firstRender = await renderPage();
    expect(getExamReview).toHaveBeenCalledTimes(1);

    const currentPanels =
      firstRender.container.querySelectorAll('.exv-q.is-current');
    expect(currentPanels).toHaveLength(1);
    expect(currentPanels[0]?.id).toBe('q-1');

    const cells = firstRender.container.querySelectorAll('.exv-cell');
    expect(cells[0]?.getAttribute('aria-current')).toBe('true');
    expect(cells[1]?.getAttribute('aria-current')).toBeNull();
    expect(cells[4]?.getAttribute('href')).toBe(
      '/learn/exam/attempts/41/review?q=5#q-5',
    );

    const firstPanel = within(currentPanels[0] as HTMLElement);
    expect(firstPanel.queryByRole('link', { name: /Câu trước/u })).toBeNull();
    const disabledPrev = firstPanel
      .getByText('Câu trước')
      .closest('[aria-disabled="true"]');
    expect(disabledPrev).not.toBeNull();
    expect(disabledPrev?.getAttribute('tabindex')).toBeNull();
    expect(
      firstPanel.getByRole('link', { name: /Câu sau/u }).getAttribute('href'),
    ).toBe('/learn/exam/attempts/41/review?q=2');
    firstRender.unmount();

    const filteredEnd = await renderPage('41', 'wrong', '3');
    const wrongCurrent =
      filteredEnd.container.querySelectorAll('.exv-q.is-current');
    expect(wrongCurrent).toHaveLength(1);
    expect(wrongCurrent[0]?.id).toBe('q-3');

    const wrongCells = filteredEnd.container.querySelectorAll('.exv-cell');
    expect(wrongCells).toHaveLength(2);
    expect(wrongCells[0]?.getAttribute('aria-current')).toBeNull();
    expect(wrongCells[0]?.getAttribute('href')).toBe(
      '/learn/exam/attempts/41/review?filter=wrong&q=2#q-2',
    );
    expect(wrongCells[1]?.getAttribute('aria-current')).toBe('true');
    expect(wrongCells[1]?.getAttribute('href')).toBe(
      '/learn/exam/attempts/41/review?filter=wrong&q=3#q-3',
    );

    const lastWrongPanel = within(wrongCurrent[0] as HTMLElement);
    expect(
      lastWrongPanel
        .getByRole('link', { name: /Câu trước/u })
        .getAttribute('href'),
    ).toBe('/learn/exam/attempts/41/review?filter=wrong&q=2');
    expect(lastWrongPanel.queryByRole('link', { name: /Câu sau/u })).toBeNull();
    const disabledNext = lastWrongPanel
      .getByText('Câu sau')
      .closest('[aria-disabled="true"]');
    expect(disabledNext).not.toBeNull();

    // Changing filter drops q
    const filterLinks = filteredEnd.container.querySelectorAll('.exv-filter');
    for (const link of filterLinks) {
      expect(link.getAttribute('href')).not.toContain('q=');
    }
  });

  it('not-founds a bad id / 404 and redirects an expired session (Q167)', async () => {
    await expect(renderPage('abc')).rejects.toThrow('NEXT_NOT_FOUND');
    vi.mocked(getExamReview).mockRejectedValue(backendFailure(404));
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'anonymous',
    } as never);
    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/sign-in');
  });
});
