import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';

import { CourseList } from './course-list';
import type { CourseSummary } from './course-model';
import type { CourseTransport } from './course-transport';

const refresh = vi.fn();
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push }),
}));

const course = (
  code: string,
  title: string,
  state: { enrolled: boolean; isCurrent: boolean },
): CourseSummary => ({
  code,
  kind: code === 'HSK3_TOPIC' ? 'topic' : 'textbook',
  curriculumVersion: code === 'HSK3_TOPIC' ? 'HSK_3_0' : 'HSK_2_0',
  title,
  description: `Mô tả ${title}`,
  progress: { completedLessons: 3, totalLessons: 12 },
  ...state,
});

const COURSES = [
  course('HSK3_TOPIC', 'Chủ đề HSK 3.0', { enrolled: true, isCurrent: true }),
  course('HSK2_TEXTBOOK', 'Giáo trình HSK chuẩn 2.0', {
    enrolled: true,
    isCurrent: false,
  }),
  course('HSK1_EXTRA', 'Khoá thêm', { enrolled: false, isCurrent: false }),
];

function fakeTransport() {
  return {
    enroll: vi
      .fn<CourseTransport['enroll']>()
      .mockResolvedValue({ ok: true, data: {} }),
    leave: vi
      .fn<CourseTransport['leave']>()
      .mockResolvedValue({ ok: true, data: null }),
    setCurrent: vi
      .fn<CourseTransport['setCurrent']>()
      .mockResolvedValue({ ok: true, data: {} }),
  };
}

function renderList(
  transport = fakeTransport(),
  courses: CourseSummary[] = COURSES,
) {
  render(
    <LearnerToastProvider>
      <CourseList
        courses={courses}
        continueHref="/learn/lessons/41"
        transport={transport}
      />
    </LearnerToastProvider>,
  );
  return transport;
}

const card = (title: string) =>
  screen.getByRole('article', { name: title }) as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    },
  });
});

describe('CourseList (C3b-UI)', () => {
  it('shows the status and the actions of each state', () => {
    renderList();
    const current = within(card('Chủ đề HSK 3.0'));
    expect(current.getByText('Đang học')).toBeInTheDocument();
    expect(current.getByRole('link', { name: 'Học tiếp' })).toHaveAttribute(
      'href',
      '/learn/lessons/41',
    );
    expect(
      current.getByRole('link', { name: 'Xem khoá Chủ đề HSK 3.0' }),
    ).toHaveAttribute('href', '/learn/courses/HSK3_TOPIC');
    // PO 24/11: the current course cannot be unfollowed.
    expect(current.queryByRole('button', { name: /Bỏ theo dõi/ })).toBeNull();
    expect(current.getByText('HSK 3.0')).toBeInTheDocument();
    expect(current.getByText('3', { selector: 'b' })).toBeInTheDocument();
    expect(current.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '25',
    );

    const following = within(card('Giáo trình HSK chuẩn 2.0'));
    expect(following.getByText('Đang theo')).toBeInTheDocument();
    expect(
      following.getByRole('button', { name: 'Học khoá này' }),
    ).toBeInTheDocument();
    expect(
      following.getByRole('button', {
        name: 'Bỏ theo dõi Giáo trình HSK chuẩn 2.0',
      }),
    ).toBeInTheDocument();
    expect(following.queryByRole('button', { name: 'Theo dõi' })).toBeNull();

    const none = within(card('Khoá thêm'));
    expect(none.getByText('Chưa theo')).toBeInTheDocument();
    expect(none.getByRole('button', { name: 'Học khoá này' })).toBeEnabled();
    expect(none.getByRole('button', { name: 'Theo dõi' })).toBeEnabled();
    expect(none.queryByRole('button', { name: /Bỏ theo dõi/ })).toBeNull();
  });

  it('sends exactly one PUT for "Học khoá này" and moves the current badge', async () => {
    const transport = renderList();
    const button = within(card('Giáo trình HSK chuẩn 2.0')).getByRole(
      'button',
      { name: 'Học khoá này' },
    );
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => {
      expect(
        within(card('Giáo trình HSK chuẩn 2.0')).getByText('Đang học'),
      ).toBeInTheDocument();
    });
    expect(transport.setCurrent).toHaveBeenCalledTimes(1);
    expect(transport.setCurrent).toHaveBeenCalledWith('HSK2_TEXTBOOK');
    expect(transport.enroll).not.toHaveBeenCalled();
    expect(within(card('Chủ đề HSK 3.0')).getByText('Đang theo')).toBeVisible();
    expect(
      screen.getByText(
        'Đã đặt “Giáo trình HSK chuẩn 2.0” làm khoá đang học. Tiến độ các khoá giữ nguyên.',
      ),
    ).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('follows a course with one POST', async () => {
    const transport = renderList();
    fireEvent.click(
      within(card('Khoá thêm')).getByRole('button', { name: 'Theo dõi' }),
    );
    await waitFor(() => {
      expect(within(card('Khoá thêm')).getByText('Đang theo')).toBeVisible();
    });
    expect(transport.enroll).toHaveBeenCalledTimes(1);
    expect(transport.enroll).toHaveBeenCalledWith('HSK1_EXTRA');
  });

  it('asks before unfollowing and returns focus to the opener', async () => {
    const transport = renderList();
    const opener = within(card('Giáo trình HSK chuẩn 2.0')).getByRole(
      'button',
      { name: 'Bỏ theo dõi Giáo trình HSK chuẩn 2.0' },
    );
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', {
      name: 'Bỏ theo dõi “Giáo trình HSK chuẩn 2.0”?',
    });
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveTextContent(
      'Khoá chuyển về “Chưa theo”. Tiến độ 3/12 bài vẫn được giữ; theo dõi lại thì học tiếp từ chỗ cũ.',
    );
    expect(transport.leave).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Giữ lại' }));
    expect(dialog).not.toHaveAttribute('open');
    expect(opener).toHaveFocus();
    expect(transport.leave).not.toHaveBeenCalled();

    fireEvent.click(opener);
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Bỏ theo dõi' }),
      );
    });
    expect(transport.leave).toHaveBeenCalledTimes(1);
    expect(transport.leave).toHaveBeenCalledWith('HSK2_TEXTBOOK');
    expect(
      within(card('Giáo trình HSK chuẩn 2.0')).getByText('Chưa theo'),
    ).toBeVisible();
    expect(
      screen.getByText('Đã bỏ theo dõi. Tiến độ vẫn được giữ.'),
    ).toBeInTheDocument();
  });

  it('keeps the state and alerts when a write fails', async () => {
    const transport = fakeTransport();
    transport.setCurrent.mockResolvedValue({ ok: false, status: 503 });
    renderList(transport);
    fireEvent.click(
      within(card('Khoá thêm')).getByRole('button', { name: 'Học khoá này' }),
    );
    expect(
      await screen.findByText('Chưa thực hiện được. Hãy thử lại.'),
    ).toHaveAttribute('role', 'alert');
    expect(within(card('Khoá thêm')).getByText('Chưa theo')).toBeVisible();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('sends the learner to sign-in when the session ended', async () => {
    const transport = fakeTransport();
    transport.enroll.mockResolvedValue({ ok: false, status: 401 });
    renderList(transport);
    fireEvent.click(
      within(card('Khoá thêm')).getByRole('button', { name: 'Theo dõi' }),
    );
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/sign-in');
    });
  });

  it('shows the empty state without a list', () => {
    renderList(fakeTransport(), []);
    expect(
      screen.getByRole('heading', { name: 'Chưa có khoá học nào' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Về Trang chủ' })).toHaveAttribute(
      'href',
      '/learn',
    );
    expect(screen.queryByRole('list')).toBeNull();
  });
});
