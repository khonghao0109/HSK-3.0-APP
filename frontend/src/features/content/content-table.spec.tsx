import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AdminLessonListItem, LevelItem } from './content-contract';
import { ContentTable } from './content-table';

const levels: LevelItem[] = [
  { id: 3, name: 'HSK 3', orderIndex: 3, code: 'HSK3', minBand: 3, maxBand: 3 },
];

const draftAwaitingReview: AdminLessonListItem = {
  id: 12,
  levelId: 3,
  title: 'Bài 12: Du lịch',
  description: null,
  orderIndex: 12,
  slug: 'bai-12-du-lich',
  status: 'draft',
  createdById: 1,
  updatedById: 1,
  publishedById: null,
  publishedAt: null,
  deletedAt: null,
  createdAt: '2026-10-10T03:00:00.000Z',
  updatedAt: '2026-10-15T09:26:00.000Z',
  latestRevision: {
    id: 5,
    entityType: 'lesson',
    entityId: 12,
    revision: 2,
    snapshot: {},
    contentHash: null,
    authorId: 1,
    createdAt: '2026-10-15T09:00:00.000Z',
    reviews: [],
  },
};

const publishedNoRevision: AdminLessonListItem = {
  ...draftAwaitingReview,
  id: 8,
  title: 'Bài 8: Thời tiết',
  slug: 'bai-8-thoi-tiet',
  orderIndex: 8,
  status: 'published',
  publishedById: 1,
  publishedAt: '2026-10-14T02:00:00.000Z',
  latestRevision: null,
};

describe('ContentTable', () => {
  it('renders a row with the right badge labels and tones (draft + awaiting review)', () => {
    render(<ContentTable lessons={[draftAwaitingReview]} levels={levels} />);
    const row = screen.getByRole('row', { name: 'Bài học Bài 12: Du lịch' });
    expect(within(row).getByText('Bài 12: Du lịch')).toBeInTheDocument();
    // Slug nằm ở dòng phụ dưới tiêu đề.
    expect(within(row).getByText('bai-12-du-lich')).toBeInTheDocument();
    expect(within(row).getByText('HSK 3')).toBeInTheDocument();
    expect(within(row).getByText('12')).toBeInTheDocument();

    const statusBadge = within(row).getByText('Bản nháp');
    expect(statusBadge.closest('.adm-badge')).toHaveClass('adm-badge--draft');
    const reviewBadge = within(row).getByText('Chờ duyệt');
    expect(reviewBadge.closest('.adm-badge')).toHaveClass('adm-badge--draft');

    // Q95: dd/mm/yyyy hh:mm giờ Việt Nam (09:26 UTC → 16:26 +07).
    expect(within(row).getByText('15/10/2026 16:26')).toBeInTheDocument();

    expect(
      within(row).getByRole('link', { name: 'Sửa Bài 12: Du lịch' }),
    ).toHaveAttribute('href', '/admin/content/lessons/12');
  });

  it('shows "—" for the review state when there is no revision', () => {
    render(<ContentTable lessons={[publishedNoRevision]} levels={levels} />);
    const row = screen.getByRole('row', { name: 'Bài học Bài 8: Thời tiết' });
    expect(
      within(row).getByText('Đã xuất bản').closest('.adm-badge'),
    ).toHaveClass('adm-badge--ok');
    expect(within(row).getByText('—')).toBeInTheDocument();
    expect(within(row).queryByText('Chờ duyệt')).not.toBeInTheDocument();
  });

  it('renders the compact record list for narrow screens with the same links', () => {
    render(<ContentTable lessons={[draftAwaitingReview]} levels={levels} />);
    const compactList = screen.getByRole('list', {
      name: 'Danh sách bài học cho màn hẹp',
    });
    const record = within(compactList).getByRole('listitem', {
      name: 'Bài học Bài 12: Du lịch',
    });
    expect(within(record).getByText('Bản nháp')).toBeInTheDocument();
    expect(within(record).getByText('Chờ duyệt')).toBeInTheDocument();
    expect(within(record).getByText('HSK 3')).toBeInTheDocument();
    expect(
      within(record).getByRole('link', { name: 'Sửa Bài 12: Du lịch' }),
    ).toHaveAttribute('href', '/admin/content/lessons/12');
  });

  it('falls back to "—" when the lesson level is not in the published level list', () => {
    render(<ContentTable lessons={[draftAwaitingReview]} levels={[]} />);
    const row = screen.getByRole('row', { name: 'Bài học Bài 12: Du lịch' });
    expect(within(row).getByText('—')).toBeInTheDocument();
    expect(within(row).queryByText('HSK 3')).not.toBeInTheDocument();
  });

  it('renders a helpful empty state with a clear-filters link', () => {
    render(<ContentTable lessons={[]} levels={levels} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Không có bài học nào khớp bộ lọc.');
    expect(
      within(status).getByRole('link', { name: 'Xoá lọc' }),
    ).toHaveAttribute('href', '/admin/content');
  });
});
