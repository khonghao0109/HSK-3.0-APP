import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notFound, redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import { getExamAttempt } from '@/features/learner-exam/exam-attempt-service';
import { FORBIDDEN_KEYS } from '@/features/learner-exam/exam-forbidden-keys';
import type { ExamAttemptView } from '@/features/learner-exam/exam-take-model';
import { BackendRequestError } from '@/lib/api/api-error';

import LearnerExamTakePage, { metadata } from './page';

const captured = vi.hoisted(() => ({ props: null as unknown }));

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
vi.mock('@/features/learner-exam/exam-attempt-service', () => ({
  getExamAttempt: vi.fn(),
}));
vi.mock('@/features/learner-exam/exam-take', () => ({
  ExamTake: (props: { attempt: unknown }) => {
    captured.props = props.attempt;
    return <div data-testid="exam-take" />;
  },
}));

function attempt(): ExamAttemptView {
  const value: ExamAttemptView = {
    id: 41,
    testId: 7,
    status: 'in_progress',
    startedAt: '2026-10-27T09:00:00.000Z',
    expiresAt: '2026-10-27T10:30:00.000Z',
    serverNow: '2026-10-27T09:00:00.000Z',
    remainingSeconds: 5_400,
    maxScore: 200,
    questionCount: 1,
    test: {
      title: 'Đề thi',
      instruction: null,
      levelCode: 'HSK4',
      durationMinutes: 90,
      passScore: 120,
    },
    sections: [
      {
        key: 's1',
        orderIndex: 1,
        title: 'Đọc hiểu',
        instruction: null,
        skill: 'reading',
        groups: [
          {
            key: 's1-g1',
            orderIndex: 1,
            title: null,
            instruction: null,
            content: null,
            audio: null,
            image: null,
            questions: [
              {
                key: 'q1',
                orderIndex: 1,
                type: 'mcq',
                skill: 'reading',
                content: 'Câu 1',
                answers: { options: [{ id: 'a', text: 'A' }] },
                audio: null,
                image: null,
              },
            ],
          },
        ],
      },
    ],
    answers: [],
  };
  return value;
}

describe('LearnerExamTakePage (TL-144)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'learner',
      token: 'token',
    } as never);
    vi.mocked(getExamAttempt).mockResolvedValue(attempt());
    captured.props = null;
  });

  it('renders the island with no forbidden R11 key in its props', async () => {
    render(
      await LearnerExamTakePage({
        params: Promise.resolve({ attemptId: '41' }),
      }),
    );
    const serialized = JSON.stringify(captured.props);
    // R1 (2c-c): dùng chung danh sách với route handler/e2e.
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(metadata.title).toBe('Làm bài thi');
  });

  it('not-founds an invalid id and redirects an unauthenticated visitor', async () => {
    await expect(
      LearnerExamTakePage({ params: Promise.resolve({ attemptId: 'abc' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'anonymous',
    } as never);
    await expect(
      LearnerExamTakePage({ params: Promise.resolve({ attemptId: '41' }) }),
    ).rejects.toThrow('NEXT_REDIRECT:/sign-in');
  });

  it('not-founds a 404 from the backend service', async () => {
    vi.mocked(getExamAttempt).mockRejectedValue(
      new BackendRequestError({
        status: 404,
        kind: 'not_found',
        message: 'gone',
        retryable: false,
      }),
    );
    await expect(
      LearnerExamTakePage({ params: Promise.resolve({ attemptId: '41' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
