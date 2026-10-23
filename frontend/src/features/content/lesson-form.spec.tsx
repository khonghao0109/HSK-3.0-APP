import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LessonForm, lessonPrefillFromSnapshot } from './lesson-form';

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
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body ?? { success: true, data: {} }), {
      status,
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const levels = [
  { id: 1, code: 'HSK1' },
  { id: 3, code: 'HSK3' },
  { id: 7, code: 'HSK7_9' },
];

function renderCreate() {
  return render(<LessonForm mode="create" levels={levels} />);
}

function fillCreateValid() {
  fireEvent.change(screen.getByLabelText('Tiêu đề *'), {
    target: { value: 'Bài 12: Du lịch' },
  });
  fireEvent.change(screen.getByLabelText('Cấp độ *'), {
    target: { value: '3' },
  });
  fireEvent.change(screen.getByLabelText('Thứ tự *'), {
    target: { value: '12' },
  });
  fireEvent.change(screen.getByLabelText('Slug *'), {
    target: { value: 'bai-12-du-lich' },
  });
}

describe('LessonForm — create', () => {
  it('shows a required error per field and focuses the first one on empty submit', () => {
    const fetchMock = stubFetch(200);
    renderCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo bài học' }));
    expect(
      screen.getByText('Vui lòng nhập tiêu đề bài học.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Vui lòng chọn cấp độ.')).toBeInTheDocument();
    expect(screen.getByText('Vui lòng nhập thứ tự.')).toBeInTheDocument();
    expect(screen.getByText('Vui lòng nhập slug.')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText('Tiêu đề *'));
    expect(screen.getByLabelText('Tiêu đề *')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non kebab-case slug with an inline error and aria wiring', () => {
    const fetchMock = stubFetch(200);
    renderCreate();
    fillCreateValid();
    fireEvent.change(screen.getByLabelText('Slug *'), {
      target: { value: 'Bài 12!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo bài học' }));
    const slug = screen.getByLabelText('Slug *');
    expect(slug).toHaveAttribute('aria-invalid', 'true');
    const errorId = slug.getAttribute('aria-describedby');
    expect(errorId).toBe('lesson-form-slug-error');
    expect(document.getElementById(errorId ?? '')).toHaveTextContent(
      /Slug chỉ gồm chữ cái thường/,
    );
    expect(document.activeElement).toBe(slug);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts CreateLesson to the BFF route and pushes to the edit page on success', async () => {
    const fetchMock = stubFetch(200, {
      success: true,
      data: { lesson: { id: 41 }, revision: { id: 70 }, idempotent: false },
    });
    renderCreate();
    fillCreateValid();
    fireEvent.change(screen.getByLabelText('Mô tả'), {
      target: { value: 'Học từ vựng về du lịch.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo bài học' }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/admin/content/lessons/41'),
    );
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/admin/content/lessons');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      title: 'Bài 12: Du lịch',
      levelId: 3,
      description: 'Học từ vựng về du lịch.',
      orderIndex: 12,
      slug: 'bai-12-du-lich',
    });
  });

  it('omits description from the body when left empty', async () => {
    const fetchMock = stubFetch(200, {
      success: true,
      data: { lesson: { id: 42 }, revision: { id: 71 }, idempotent: false },
    });
    renderCreate();
    fillCreateValid();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo bài học' }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('description');
  });

  it('maps a 409 error.code to the Vietnamese conflict sentence (TL-14)', async () => {
    stubFetch(409, {
      success: false,
      error: { status: 409, code: 'CONTENT_UNIQUE_CONFLICT' },
    });
    renderCreate();
    fillCreateValid();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo bài học' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Slug hoặc thứ tự đã được dùng cho nội dung khác. Chọn giá trị khác.',
    );
    expect(push).not.toHaveBeenCalled();
  });
});

describe('LessonForm — edit (TL-15)', () => {
  const initial = {
    title: 'Bài 12: Du lịch',
    description: 'Mô tả cũ.',
    orderIndex: 12,
    slug: 'bai-12-du-lich',
  };

  function renderEdit(overrides?: {
    archived?: boolean;
    initial?: Partial<typeof initial>;
  }) {
    return render(
      <LessonForm
        mode="edit"
        lessonId={41}
        levelText="HSK 3"
        archived={overrides?.archived ?? false}
        initial={{ ...initial, ...overrides?.initial }}
      />,
    );
  }

  it('prefills from the latest revision snapshot and shows level as read-only text', () => {
    renderEdit();
    expect(screen.getByLabelText('Tiêu đề *')).toHaveValue('Bài 12: Du lịch');
    expect(screen.getByLabelText('Mô tả')).toHaveValue('Mô tả cũ.');
    expect(screen.getByLabelText('Thứ tự *')).toHaveValue(12);
    expect(screen.getByLabelText('Slug *')).toHaveValue('bai-12-du-lich');
    // TL-12: cấp độ chỉ đọc — không có select trên trang sửa.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('HSK 3')).toBeInTheDocument();
  });

  it('posts a new revision (no levelId) and refreshes on success', async () => {
    const fetchMock = stubFetch(200, {
      success: true,
      data: { lesson: { id: 41 }, revision: { id: 71 }, idempotent: false },
    });
    renderEdit();
    fireEvent.change(screen.getByLabelText('Tiêu đề *'), {
      target: { value: 'Bài 12: Du lịch (sửa)' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản sửa' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/admin/content/lessons/41/revisions');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      title: 'Bài 12: Du lịch (sửa)',
      description: 'Mô tả cũ.',
      orderIndex: 12,
      slug: 'bai-12-du-lich',
    });
    expect(body).not.toHaveProperty('levelId');
    expect(push).not.toHaveBeenCalled();
  });

  it('names the read-only level group "Cấp độ" (R13)', () => {
    renderEdit();
    expect(screen.getByRole('group', { name: /Cấp độ/u })).toHaveTextContent(
      'HSK 3',
    );
  });

  it('401 → replaces to the session login; 403 → no-permission sentence (R11)', async () => {
    stubFetch(401, { success: false, error: { code: 'UNAUTHORIZED' } });
    const { unmount } = renderEdit();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản sửa' }));
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/login?reason=session'),
    );
    unmount();
    stubFetch(403, { success: false, error: { code: 'FORBIDDEN' } });
    renderEdit();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản sửa' }));
    expect(
      await screen.findByText('Bạn không có quyền thực hiện thao tác này.'),
    ).toBeInTheDocument();
  });

  it('locks the whole form with a muted note when the lesson is archived', () => {
    renderEdit({ archived: true });
    expect(
      screen.getByText('Bài học đã lưu trữ, chỉ xem.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Tiêu đề *')).toBeDisabled();
    expect(screen.getByLabelText('Mô tả')).toBeDisabled();
    expect(screen.getByLabelText('Thứ tự *')).toBeDisabled();
    expect(screen.getByLabelText('Slug *')).toBeDisabled();
    // R8: bài đã lưu trữ ẩn hẳn nút lưu.
    expect(
      screen.queryByRole('button', { name: 'Lưu bản sửa' }),
    ).not.toBeInTheDocument();
  });
});

describe('lessonPrefillFromSnapshot (TL-15)', () => {
  it('reads a valid snapshot and defaults a missing description', () => {
    expect(
      lessonPrefillFromSnapshot({
        title: 'Bài 12',
        orderIndex: 12,
        slug: 'bai-12',
        description: null,
      }),
    ).toEqual({
      title: 'Bài 12',
      description: '',
      orderIndex: 12,
      slug: 'bai-12',
    });
  });

  it('returns null for missing or malformed snapshots', () => {
    expect(lessonPrefillFromSnapshot(null)).toBeNull();
    expect(lessonPrefillFromSnapshot('bai-12')).toBeNull();
    expect(
      lessonPrefillFromSnapshot({ title: 'Bài 12', slug: 'bai-12' }),
    ).toBeNull();
  });
});
