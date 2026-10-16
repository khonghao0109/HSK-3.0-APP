import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AdminMedia } from './media-contract';
import { MediaTable } from './media-table';

const asset: AdminMedia = {
  id: 41,
  filename: 'lesson.mp3',
  type: 'audio',
  mimeType: 'audio/mpeg',
  size: 2048,
  duration: 8,
  processingStatus: 'ready',
  lifecycle: 'active',
  usageCount: 1,
  dataSourceId: 7,
  uploadedById: 1,
  updatedById: 2,
  deletedAt: null,
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-12T01:00:00.000Z',
  dataSource: {
    id: 7,
    code: 'HSK_AUDIO',
    name: 'Licensed audio',
    version: '2026.08',
  },
};

describe('MediaTable', () => {
  it('renders a desktop table and a labelled compact inventory', () => {
    render(<MediaTable media={[asset]} />);

    const row = screen.getByRole('row', { name: /media 41/i });
    expect(within(row).getByText('lesson.mp3')).toBeInTheDocument();
    expect(within(row).getByText('Sẵn sàng')).toBeInTheDocument();
    expect(
      within(row).getByRole('link', { name: /mở media 41/i }),
    ).toHaveAttribute('href', '/admin/media/41');

    const compact = screen.getByRole('list', {
      name: 'Danh sách media cho màn hẹp',
    });
    expect(
      within(compact).getByRole('listitem', { name: /media 41/i }),
    ).toHaveTextContent('lesson.mp3');
  });

  it('renders directed empty-state guidance without a fake upload action', () => {
    render(<MediaTable media={[]} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Không có media nào khớp bộ lọc.',
    );
    expect(
      screen.queryByRole('button', { name: /upload/i }),
    ).not.toBeInTheDocument();
  });
});
