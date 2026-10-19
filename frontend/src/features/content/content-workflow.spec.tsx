import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContentWorkflow } from './content-workflow';

const { refresh, replace } = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, replace }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
  replace.mockReset();
});

function stubFetch(status: number, body?: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify(
        body ?? {
          success: status < 400,
          ...(status < 400 ? { data: { idempotent: false } } : {}),
        },
      ),
      { status },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const draftRevision = {
  id: 70,
  revision: 1,
  authorId: 7,
  createdAt: '2026-10-15T22:26:00Z',
  reviews: [],
};

const approvedRevision = {
  ...draftRevision,
  reviews: [
    {
      decision: 'approved',
      reviewerId: 7,
      createdAt: '2026-10-15T22:30:00Z',
    },
  ],
};

function renderWorkflow(
  overrides?: Partial<Parameters<typeof ContentWorkflow>[0]>,
) {
  return render(
    <ContentWorkflow
      entity="lessons"
      entityId={41}
      status="draft"
      latestRevision={draftRevision}
      sessionAdminId={7}
      {...overrides}
    />,
  );
}

describe('ContentWorkflow (M5.1a)', () => {
  it('shows the Q89 self-review warning only when the admin authored the latest revision', () => {
    renderWorkflow();
    expect(
      screen.getByText(/Tự duyệt được phép và sẽ được ghi lại/),
    ).toBeInTheDocument();

    renderWorkflow({ sessionAdminId: 99 });
    expect(
      screen.queryAllByText(/Tự duyệt được phép và sẽ được ghi lại/),
    ).toHaveLength(1);
  });

  it('labels the author as "Bạn" and others as "Quản trị viên #id" (TL-13)', () => {
    renderWorkflow();
    expect(screen.getByText('Bạn')).toBeInTheDocument();
    renderWorkflow({
      latestRevision: { ...draftRevision, authorId: 12 },
    });
    expect(screen.getByText('Quản trị viên #12')).toBeInTheDocument();
  });

  it('keeps publish disabled with a reason until the latest review approves', () => {
    renderWorkflow();
    expect(screen.getByRole('button', { name: 'Xuất bản' })).toBeDisabled();
    expect(screen.getByText(/đang chờ duyệt/)).toBeInTheDocument();

    renderWorkflow({
      latestRevision: {
        ...draftRevision,
        reviews: [
          {
            decision: 'changes_requested',
            reviewerId: 3,
            createdAt: '2026-10-15T22:30:00Z',
          },
        ],
      },
    });
    expect(
      screen.getAllByRole('button', { name: 'Xuất bản' })[1],
    ).toBeDisabled();
  });

  it('disables publish with "đã được xuất bản" once step 4 (S1)', () => {
    // publishedAt sau bản sửa → bước 4 dù không cần so nội dung.
    renderWorkflow({
      status: 'published',
      publishedAt: '2026-10-15T22:40:00Z',
      latestRevision: approvedRevision,
    });
    expect(screen.getByRole('button', { name: 'Xuất bản' })).toBeDisabled();
    expect(
      screen.getByText('Bản sửa mới nhất đã được xuất bản.'),
    ).toBeInTheDocument();

    // publishedAt cũ hơn bản sửa nhưng live trùng snapshot → vẫn bước 4.
    renderWorkflow({
      status: 'published',
      publishedAt: '2026-10-14T00:00:00Z',
      latestRevision: approvedRevision,
      live: { title: 'Bài', description: null, orderIndex: 1, slug: 'bai' },
      snapshot: { title: 'Bài', description: null, orderIndex: 1, slug: 'bai' },
    });
    expect(
      screen.getAllByRole('button', { name: 'Xuất bản' })[1],
    ).toBeDisabled();
  });

  it('enables publish after approval and calls the publish BFF route', async () => {
    const fetchMock = stubFetch(200);
    renderWorkflow({ latestRevision: approvedRevision });
    fireEvent.click(screen.getByRole('button', { name: 'Xuất bản' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/content/lessons/41/revisions/70/publish',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('submits the review decision with an optional note to the latest revision only', async () => {
    const fetchMock = stubFetch(200);
    renderWorkflow();
    fireEvent.click(screen.getByRole('radio', { name: 'Yêu cầu sửa' }));
    fireEvent.change(screen.getByLabelText('Ghi chú đánh giá'), {
      target: { value: 'Cần bổ sung ví dụ.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/admin/content/lessons/41/revisions/70/reviews');
    expect(JSON.parse(String(init?.body))).toEqual({
      decision: 'changes_requested',
      note: 'Cần bổ sung ví dụ.',
    });
  });

  it('maps a 409 error.code to the Vietnamese conflict sentence (TL-14)', async () => {
    stubFetch(409, {
      success: false,
      error: { status: 409, code: 'LESSON_NO_PUBLISHED_CHILD' },
    });
    renderWorkflow({ latestRevision: approvedRevision });
    fireEvent.click(screen.getByRole('button', { name: 'Xuất bản' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent(
      /ít nhất một chủ đề hoặc truyện đã xuất bản/,
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not preselect a decision and blocks submit with an inline error (TL-17)', () => {
    const fetchMock = stubFetch(200);
    renderWorkflow();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toBeChecked();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    expect(fetchMock).not.toHaveBeenCalled();
    const message = screen.getByText('Vui lòng chọn quyết định đánh giá.');
    const first = screen.getByRole('radio', { name: 'Duyệt' });
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute('aria-describedby', message.id);
    fireEvent.click(first);
    expect(
      screen.queryByText('Vui lòng chọn quyết định đánh giá.'),
    ).not.toBeInTheDocument();
  });

  it('draws the 4 publish steps with the current one marked (TL-16)', () => {
    renderWorkflow({
      status: 'published',
      publishedAt: '2026-10-15T23:00:00Z',
      publishedById: 12,
      latestRevision: approvedRevision,
    });
    const steps = screen.getAllByRole('listitem');
    expect(steps.map((step) => step.querySelector('b')?.textContent)).toEqual([
      'Đã xong: Bản nháp',
      'Đã xong: Gửi duyệt',
      'Đã xong: Đã duyệt',
      'Đã xuất bản',
    ]);
    expect(steps[3]).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Cập nhật: 16/10/2026 06:00')).toBeInTheDocument();
    expect(screen.getByText('Bởi: Quản trị viên #12')).toBeInTheDocument();

    renderWorkflow();
    const pending = screen.getAllByRole('list', {
      name: 'Các bước xuất bản',
    })[1];
    expect(pending?.querySelector('[aria-current="step"]')).toHaveTextContent(
      'Gửi duyệtChờ duyệt',
    );
  });

  it('redirects to sign-in on 401 and shows the permission sentence on 403 (R11)', async () => {
    stubFetch(401);
    renderWorkflow({ latestRevision: approvedRevision });
    fireEvent.click(screen.getByRole('button', { name: 'Xuất bản' }));
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/login?reason=session'),
    );

    cleanup();
    stubFetch(403);
    renderWorkflow({ latestRevision: approvedRevision });
    fireEvent.click(screen.getByRole('button', { name: 'Xuất bản' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bạn không có quyền thực hiện thao tác này.',
    );
  });

  it('requires inline archive confirmation and hides all actions when archived', async () => {
    const fetchMock = stubFetch(200);
    const { rerender } = renderWorkflow({ latestRevision: approvedRevision });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu trữ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận lưu trữ' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/content/lessons/41/archive',
      expect.objectContaining({ method: 'POST' }),
    );

    rerender(
      <ContentWorkflow
        entity="lessons"
        entityId={41}
        status="archived"
        latestRevision={approvedRevision}
        sessionAdminId={7}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(
      screen.getByText(/Đã lưu trữ — không thể thay đổi/),
    ).toBeInTheDocument();
  });

  it('posts exercise publish and archive to the exercises BFF routes (F4)', async () => {
    const fetchMock = stubFetch(200);
    const { rerender } = renderWorkflow({
      entity: 'exercises',
      latestRevision: approvedRevision,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xuất bản' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/exercises/41/revisions/70/publish',
      expect.objectContaining({ method: 'POST' }),
    );

    refresh.mockReset();
    rerender(
      <ContentWorkflow
        entity="exercises"
        entityId={41}
        status="draft"
        latestRevision={approvedRevision}
        sessionAdminId={7}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Lưu trữ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận lưu trữ' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/exercises/41/archive',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('keeps the exercise publish button off with the TL-21 reason when the type cannot be published', () => {
    renderWorkflow({
      entity: 'exercises',
      latestRevision: approvedRevision,
      publishBlockedReason: 'Loại này chưa xuất bản được.',
    });
    expect(screen.getByRole('button', { name: 'Xuất bản' })).toBeDisabled();
    expect(
      screen.getByText('Loại này chưa xuất bản được.'),
    ).toBeInTheDocument();
  });

  it('recognises an idempotent exercise publish as step 4 from live matching snapshot (TL-21)', () => {
    renderWorkflow({
      entity: 'exercises',
      status: 'published',
      publishedAt: '2026-10-14T00:00:00Z',
      latestRevision: approvedRevision,
      live: {
        type: 'fill_blank',
        prompt: 'Điền từ còn thiếu',
        content: {},
        answer: { acceptedTexts: ['好'] },
        explanation: null,
        mediaId: null,
        orderIndex: 2,
        // R3: version live phải bằng revision mới nhất mới tính bước 4.
        version: 1,
      },
      snapshot: {
        type: 'fill_blank',
        prompt: 'Điền từ còn thiếu',
        content: {},
        answer: { acceptedTexts: ['好'] },
        explanation: null,
        mediaId: null,
        orderIndex: 2,
      },
    });
    expect(screen.getByRole('button', { name: 'Xuất bản' })).toBeDisabled();
    expect(
      screen.getByText('Bản sửa mới nhất đã được xuất bản.'),
    ).toBeInTheDocument();
  });

  // R2 (M5.1b1 A'): 422 của bài tập hiện đúng nhãn TL-20; lesson/topic giữ câu chung.
  it('maps exercise 422 codes to their TL-20 Vietnamese labels (R2)', async () => {
    stubFetch(422, {
      success: false,
      error: { status: 422, code: 'listening_media_not_ready' },
    });
    renderWorkflow({
      entity: 'exercises',
      latestRevision: approvedRevision,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xuất bản' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Audio phải sẵn sàng và chưa bị xoá.',
    );

    cleanup();
    stubFetch(422, {
      success: false,
      error: {
        status: 422,
        code: 'EXERCISE_TYPE_NOT_PUBLISHABLE',
      },
    });
    renderWorkflow({
      entity: 'exercises',
      latestRevision: approvedRevision,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xuất bản' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Loại này chưa xuất bản được.',
    );
    expect(refresh).not.toHaveBeenCalled();

    cleanup();
    stubFetch(422, {
      success: false,
      error: { status: 422, code: 'listening_media_not_ready' },
    });
    renderWorkflow({ entity: 'lessons', latestRevision: approvedRevision });
    fireEvent.click(screen.getByRole('button', { name: 'Xuất bản' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Thao tác tạm thời không khả dụng. Hãy thử lại.',
    );
  });

  // R3 (M5.1b1 A'): nội dung khớp nhưng version ≠ revision → chưa phải bước 4,
  // nút Xuất bản vẫn bật khi bản mới nhất đã duyệt.
  it('keeps exercise publish enabled when content matches but live version is older (R3)', () => {
    renderWorkflow({
      entity: 'exercises',
      status: 'published',
      publishedAt: '2026-10-14T00:00:00Z',
      latestRevision: approvedRevision,
      live: {
        type: 'fill_blank',
        prompt: 'Điền từ còn thiếu',
        content: {},
        answer: { acceptedTexts: ['好'] },
        explanation: null,
        mediaId: null,
        orderIndex: 2,
        version: 2,
      },
      snapshot: {
        type: 'fill_blank',
        prompt: 'Điền từ còn thiếu',
        content: {},
        answer: { acceptedTexts: ['好'] },
        explanation: null,
        mediaId: null,
        orderIndex: 2,
      },
    });
    expect(screen.getByRole('button', { name: 'Xuất bản' })).toBeEnabled();
    expect(
      screen.queryByText('Bản sửa mới nhất đã được xuất bản.'),
    ).not.toBeInTheDocument();
  });
});
