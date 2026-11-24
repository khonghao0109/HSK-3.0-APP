import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';

import { CourseMakeCurrent } from './course-make-current';
import type { CourseTransport } from './course-transport';

const refresh = vi.fn();
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push }),
}));

function renderButton(
  result: Awaited<ReturnType<CourseTransport['setCurrent']>>,
) {
  const setCurrent = vi
    .fn<CourseTransport['setCurrent']>()
    .mockResolvedValue(result);
  render(
    <LearnerToastProvider>
      <CourseMakeCurrent
        code="HSK2_TEXTBOOK"
        title="Giáo trình HSK chuẩn 2.0"
        transport={{ setCurrent }}
      />
    </LearnerToastProvider>,
  );
  return setCurrent;
}

beforeEach(() => vi.clearAllMocks());

describe('CourseMakeCurrent (C3b-UI)', () => {
  it('sends one PUT, refreshes the page and announces it', async () => {
    const setCurrent = renderButton({ ok: true, data: {} });
    const button = screen.getByRole('button', { name: 'Học khoá này' });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(setCurrent).toHaveBeenCalledTimes(1);
    expect(setCurrent).toHaveBeenCalledWith('HSK2_TEXTBOOK');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(
        'Đã đặt “Giáo trình HSK chuẩn 2.0” làm khoá đang học. Tiến độ các khoá giữ nguyên.',
      ),
    ).toBeInTheDocument();
  });

  it('alerts on failure and does not refresh', async () => {
    renderButton({ ok: false, status: 503 });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Học khoá này' }));
    });
    expect(
      screen.getByText('Chưa thực hiện được. Hãy thử lại.'),
    ).toHaveAttribute('role', 'alert');
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Học khoá này' })).toBeEnabled();
  });
});
