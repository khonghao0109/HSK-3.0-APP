import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ExerciseTable } from './exercise-table';
import type { AdminExercise } from './exercise-contract';

const exercise: AdminExercise = {
  id: 101,
  lessonId: 12,
  topicId: 34,
  mediaId: null,
  type: 'mcq',
  prompt: 'Chọn nghĩa đúng của 你好',
  content: { options: [{ id: 'hello', text: 'Xin chào' }] },
  answer: { optionId: 'hello' },
  explanation: 'Lời chào thông dụng.',
  version: 2,
  orderIndex: 1,
  status: 'published',
  dataSourceId: 7,
  sourceKey: 'hsk1.lesson12.exercise101',
  createdById: 1,
  updatedById: 1,
  publishedById: 1,
  publishedAt: '2026-08-11T00:00:00.000Z',
  deletedAt: null,
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z',
  lesson: { id: 12, title: 'Chào hỏi', slug: 'chao-hoi' },
  topic: { id: 34, title: 'Lời chào đầu tiên' },
  dataSource: { id: 7, code: 'HSK3', name: 'HSK source', version: '1' },
  media: null,
  latestRevision: null,
};

describe('ExerciseTable', () => {
  it('renders operational identity and a deep link without authoritative answer', () => {
    render(<ExerciseTable exercises={[exercise]} />);
    const row = screen.getByRole('row', { name: /101/i });
    expect(within(row).getByText('Chào hỏi')).toBeInTheDocument();
    expect(within(row).getByText('Lời chào đầu tiên')).toBeInTheDocument();
    expect(within(row).getByText('Published')).toBeInTheDocument();
    expect(
      within(row).getByRole('link', { name: /open exercise 101/i }),
    ).toHaveAttribute('href', '/admin/exercises/101');
    expect(screen.queryByText('hello')).not.toBeInTheDocument();

    const compactList = screen.getByRole('list', {
      name: 'Exercises for narrow screens',
    });
    const compactRecord = within(compactList).getByRole('listitem', {
      name: /exercise 101/i,
    });
    expect(within(compactRecord).getByText('EX-101')).toBeInTheDocument();
    expect(within(compactRecord).getByText('Published')).toBeInTheDocument();
    expect(
      within(compactRecord).getByRole('link', { name: /open exercise 101/i }),
    ).toHaveAttribute('href', '/admin/exercises/101');
  });

  it('renders a helpful empty state', () => {
    render(<ExerciseTable exercises={[]} />);
    expect(screen.getByRole('status')).toHaveTextContent('No exercises match');
  });
});
