import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ExerciseDetail } from './exercise-detail';
import type { AdminExerciseDetail } from './exercise-contract';

const detail: AdminExerciseDetail = {
  id: 102,
  lessonId: 12,
  topicId: 34,
  mediaId: 88,
  type: 'listening_choice',
  prompt: 'Nghe và chọn đáp án đúng',
  content: { options: [{ id: 'market', text: '超市' }] },
  answer: { optionId: 'market' },
  explanation: 'Đáp án là 超市.',
  version: 3,
  orderIndex: 2,
  status: 'published',
  dataSourceId: 7,
  sourceKey: 'hsk1.lesson12.exercise102',
  createdById: 1,
  updatedById: 1,
  publishedById: 1,
  publishedAt: '2026-08-11T00:00:00.000Z',
  deletedAt: null,
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z',
  lesson: { id: 12, title: 'Mua sắm', slug: 'mua-sam' },
  topic: { id: 34, title: 'Địa điểm mua sắm' },
  dataSource: { id: 7, code: 'HSK3', name: 'HSK source', version: '1' },
  media: {
    id: 88,
    url: 'https://cdn.example.test/audio/market.mp3',
    type: 'audio',
    mimeType: 'audio/mpeg',
    duration: 8,
    processingStatus: 'ready',
    deletedAt: null,
  },
  revisions: [
    {
      id: 900,
      entityType: 'lesson_exercise',
      entityId: 102,
      revision: 3,
      snapshot: { prompt: 'Nghe và chọn đáp án đúng' },
      contentHash: 'hash',
      authorId: 1,
      createdAt: '2026-08-11T00:00:00.000Z',
      reviews: [
        {
          id: 901,
          reviewerId: 1,
          decision: 'approved',
          note: 'Ready',
          createdAt: '2026-08-11T00:01:00.000Z',
        },
      ],
    },
  ],
};

describe('ExerciseDetail', () => {
  it('renders canonical content, admin-only answer, provenance, safe media, and review', () => {
    render(<ExerciseDetail exercise={detail} canViewAnswer />);
    expect(
      screen.getByRole('heading', { name: /exercise 102/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Mua sắm')).toBeInTheDocument();
    expect(screen.getByText('Địa điểm mua sắm')).toBeInTheDocument();
    expect(screen.getByText(/"optionId": "market"/)).toBeInTheDocument();
    expect(screen.getByText('HSK source')).toBeInTheDocument();
    expect(screen.getByText('audio/mpeg')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('storageKey');
    expect(document.body.textContent).not.toContain('checksum');
  });

  it('does not render authoritative answer outside authenticated admin detail', () => {
    render(<ExerciseDetail exercise={detail} canViewAnswer={false} />);
    expect(screen.queryByText(/"optionId": "market"/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/restricted to authenticated administrators/i),
    ).toBeInTheDocument();
  });
});
