import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopicForm, type TopicFormInitial } from './topic-form';

const { push, refresh, replace } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh, replace }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
  refresh.mockReset();
  replace.mockReset();
});

function stubFetch(status: number, body?: unknown) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify(body ?? { success: true }), { status }),
    );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function fillValidCreate() {
  fireEvent.change(screen.getByLabelText(/Tiêu đề/), {
    target: { value: 'Từ vựng chủ đề du lịch' },
  });
  fireEvent.change(screen.getByLabelText(/Nội dung JSON/), {
    target: { value: '[{"type":"text","value":"Xin chào"}]' },
  });
  fireEvent.change(screen.getByLabelText(/Thứ tự/), { target: { value: '3' } });
}

describe('TopicForm (M5.1a, Q90)', () => {
  it('create: thiếu trường bắt buộc → báo lỗi và focus field lỗi đầu tiên', () => {
    stubFetch(200);
    render(<TopicForm mode="create" lessonId={41} />);
    // Xoá prefill JSON để còn thiếu cả tiêu đề lẫn nội dung.
    fireEvent.change(screen.getByLabelText(/Nội dung JSON/), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo chủ đề' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Vui lòng nhập tiêu đề chủ đề.',
    );
    expect(screen.getByLabelText(/Tiêu đề/)).toHaveFocus();

    // Có tiêu đề nhưng thiếu nội dung JSON → focus textarea.
    fireEvent.change(screen.getByLabelText(/Tiêu đề/), {
      target: { value: 'Ngữ pháp' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo chủ đề' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Vui lòng nhập nội dung JSON.',
    );
    expect(screen.getByLabelText(/Nội dung JSON/)).toHaveFocus();
  });

  it('create: submit hợp lệ gửi contentText (string), không gửi content; thành công → push tới trang chủ đề', async () => {
    const fetchMock = stubFetch(200, {
      success: true,
      data: { idempotent: false, topic: { id: 34 } },
    });
    render(<TopicForm mode="create" lessonId={41} />);
    fillValidCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo chủ đề' }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/admin/content/topics/34'),
    );
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/admin/content/topics');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      lessonId: 41,
      title: 'Từ vựng chủ đề du lịch',
      subtitle: null,
      type: 'vocabulary',
      orderIndex: 3,
      isPremium: false,
      isLocked: false,
    });
    expect(typeof body.contentText).toBe('string');
    expect(body).not.toHaveProperty('content');
  });

  it('server INVALID_JSON kèm vị trí → hiện dòng/cột, textarea aria-invalid và nhận focus', async () => {
    stubFetch(400, {
      success: false,
      error: {
        status: 400,
        kind: 'invalid_request',
        code: 'INVALID_JSON',
        message: 'Invalid JSON.',
        line: 3,
        column: 12,
      },
    });
    render(<TopicForm mode="create" lessonId={41} />);
    fillValidCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo chủ đề' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'JSON sai ở dòng 3, cột 12',
    );
    const textarea = screen.getByLabelText(/Nội dung JSON/);
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(textarea).toHaveAttribute('aria-describedby', 'topic-form-error');
    expect(textarea).toHaveFocus();
  });

  it('server INVALID_JSON không vị trí → câu chung; JSON_TOO_LARGE → câu 100 KB', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<TopicForm mode="create" lessonId={41} />);
    fillValidCreate();

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: { status: 400, code: 'INVALID_JSON' },
        }),
        { status: 400 },
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tạo chủ đề' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('JSON không hợp lệ.');

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: { status: 400, code: 'JSON_TOO_LARGE' },
        }),
        { status: 400 },
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tạo chủ đề' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Nội dung JSON vượt quá 100 KB.',
      ),
    );
  });

  it('server 409 → câu xung đột tiếng Việt theo error.code (TL-14)', async () => {
    stubFetch(409, {
      success: false,
      error: { status: 409, code: 'CONTENT_UNIQUE_CONFLICT' },
    });
    render(<TopicForm mode="create" lessonId={41} />);
    fillValidCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo chủ đề' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Slug hoặc thứ tự đã được dùng cho nội dung khác. Chọn giá trị khác.',
    );
    expect(push).not.toHaveBeenCalled();
  });

  it('edit: prefill JSON.stringify(content, null, 2) và POST tới revisions', async () => {
    const fetchMock = stubFetch(200, {
      success: true,
      data: { idempotent: false },
    });
    const initial: TopicFormInitial = {
      title: 'Từ vựng',
      subtitle: 'Chủ đề du lịch',
      type: 'grammar',
      contentText: JSON.stringify([{ type: 'text', value: '你好' }], null, 2),
      orderIndex: 2,
      isPremium: true,
      isLocked: false,
    };
    render(
      <TopicForm mode="edit" lessonId={41} topicId={9} initial={initial} />,
    );
    expect(screen.getByLabelText(/Nội dung JSON/)).toHaveValue(
      JSON.stringify([{ type: 'text', value: '你好' }], null, 2),
    );
    expect(screen.getByLabelText(/Tiêu đề/)).toHaveValue('Từ vựng');
    expect(screen.getByLabelText('Premium')).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản sửa' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/admin/content/topics/9/revisions');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty('lessonId');
    expect(body).toMatchObject({
      title: 'Từ vựng',
      subtitle: 'Chủ đề du lịch',
      type: 'grammar',
      orderIndex: 2,
      isPremium: true,
      isLocked: false,
    });
    expect(typeof body.contentText).toBe('string');
  });

  it('edit: 401 → về trang đăng nhập; 403 → câu không có quyền (R11)', async () => {
    const initial = {
      title: 'Từ vựng',
      subtitle: '',
      type: 'grammar',
      contentText: '[]',
      orderIndex: 2,
      isPremium: false,
      isLocked: false,
    };
    stubFetch(401, { success: false, error: { code: 'UNAUTHORIZED' } });
    const { unmount } = render(
      <TopicForm mode="edit" lessonId={41} topicId={9} initial={initial} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản sửa' }));
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/login?reason=session'),
    );
    unmount();
    stubFetch(403, { success: false, error: { code: 'FORBIDDEN' } });
    render(
      <TopicForm mode="edit" lessonId={41} topicId={9} initial={initial} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản sửa' }));
    expect(
      await screen.findByText('Bạn không có quyền thực hiện thao tác này.'),
    ).toBeInTheDocument();
  });

  it('archived: form chỉ xem, có ghi chú, không nút lưu', () => {
    render(<TopicForm mode="edit" lessonId={41} topicId={9} archived />);
    expect(screen.getByText('Chủ đề đã lưu trữ, chỉ xem.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lưu bản sửa' })).toBeNull();
    expect(screen.getByLabelText(/Tiêu đề/)).toBeDisabled();
  });

  it('có link quay về bài học', () => {
    render(<TopicForm mode="create" lessonId={41} />);
    expect(screen.getByRole('link', { name: '← Bài học' })).toHaveAttribute(
      'href',
      '/admin/content/lessons/41',
    );
  });
});
