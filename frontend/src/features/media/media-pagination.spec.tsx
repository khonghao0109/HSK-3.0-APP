import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MediaPagination } from './media-pagination';

const label = 'Phân trang tải lên cần xử lý';

function renderPage(page: number, total: number) {
  return render(
    <MediaPagination
      query={{ page, limit: 20 }}
      total={total}
      totalPages={Math.max(1, Math.ceil(total / 20))}
      pageHref={(next) => `?page=${next}`}
      label={label}
    />,
  );
}

describe('MediaPagination (V1)', () => {
  it('shows the range on a page with rows', () => {
    renderPage(2, 25);
    expect(screen.getByRole('navigation', { name: label })).toBeInTheDocument();
    expect(
      screen.getByText('Hiển thị 21 đến 25 của 25 kết quả'),
    ).toBeInTheDocument();
  });

  it('renders nothing on an overflow page', () => {
    renderPage(5, 25);
    expect(screen.queryByRole('navigation', { name: label })).toBeNull();
    expect(screen.queryByText(/Hiển thị/u)).toBeNull();
  });
});
