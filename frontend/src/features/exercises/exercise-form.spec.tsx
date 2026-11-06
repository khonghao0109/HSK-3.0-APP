import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EXERCISE_FORM_MESSAGE,
  contentConflictMessage,
} from '@/features/admin-shell/admin-labels';

import {
  FORBIDDEN_MESSAGE,
  SESSION_LOGIN_PATH,
} from '../content/content-values';

import { ExerciseForm } from './exercise-form';
import type { ExerciseFormValue } from './exercise-form-values';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
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

/** Y3/Y5: nhiều lần gửi liên tiếp, mỗi lần một response mới. */
function stubFetchSequence(
  responses: Array<{ status: number; body?: unknown }>,
) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const next = responses.shift();
      if (next === undefined) {
        throw new Error(
          `unexpected fetch call: ${String(input)} ${init?.method ?? 'GET'}`,
        );
      }
      return new Response(
        JSON.stringify(next.body ?? { success: true, data: {} }),
        { status: next.status },
      );
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function fetchBody(
  fetchMock: ReturnType<typeof stubFetchSequence>,
  index: number,
): {
  content: { tokens: { id: string; text: string }[] };
  answer: { tokenIds: string[] };
} {
  const init = fetchMock.mock.calls[index]?.[1];
  return JSON.parse(String(init?.body)) as {
    content: { tokens: { id: string; text: string }[] };
    answer: { tokenIds: string[] };
  };
}

const lessons = [
  { id: 7, title: 'Bài 12: Du lịch', levelCode: 'HSK3' },
  { id: 8, title: 'Bài 13: Sức khoẻ', levelCode: 'HSK3' },
];
const topics = [{ id: 9, title: 'Chủ đề A' }];
const audio = [
  { id: 5, filename: 'bai12-hoithoai.mp3' },
  { id: 6, filename: null },
];

function renderCreate(initialLessonId: number | null = 7) {
  const onSaved = vi.fn();
  const view = render(
    <ExerciseForm
      mode="create"
      lessons={lessons}
      topics={topics}
      audio={audio}
      initialLessonId={initialLessonId}
      submitPath="/api/admin/exercises"
      onSaved={onSaved}
    />,
  );
  return { onSaved, unmount: view.unmount };
}

const editInitial: ExerciseFormValue = {
  type: 'mcq',
  prompt: 'Đề bài cũ',
  explanation: '',
  orderIndex: '3',
  options: [
    { id: 'opt-1', text: 'A' },
    { id: 'opt-2', text: 'B' },
  ],
  correctOptionId: 'opt-1',
  acceptedTexts: [],
  caseSensitive: false,
  tokens: [],
  tokenOrder: [],
  tokenDisplayOrder: [],
  referenceText: '',
  mediaId: null,
};

function renderEdit(
  overrides: Partial<{ archived: boolean; initial: ExerciseFormValue }> = {},
) {
  const onSaved = vi.fn();
  const view = render(
    <ExerciseForm
      mode="edit"
      initial={overrides.initial ?? editInitial}
      lessonTitle="Bài 12: Du lịch"
      topicTitle="Chủ đề A"
      archived={overrides.archived ?? false}
      audio={audio}
      submitPath="/api/admin/exercises/41/revisions"
      onSaved={onSaved}
    />,
  );
  return { onSaved, unmount: view.unmount };
}

function fillValidMcq() {
  fireEvent.change(screen.getByLabelText('Đề bài *'), {
    target: { value: 'Chọn đáp án đúng' },
  });
  fireEvent.change(screen.getByLabelText('Thứ tự *'), {
    target: { value: '3' },
  });
  fireEvent.change(screen.getByLabelText('Lựa chọn 1'), {
    target: { value: 'A' },
  });
  fireEvent.change(screen.getByLabelText('Lựa chọn 2'), {
    target: { value: 'B' },
  });
  fireEvent.click(screen.getByLabelText('Đáp án đúng cho lựa chọn 1'));
}

function submitCreate() {
  fireEvent.click(screen.getByRole('button', { name: 'Tạo bài tập' }));
}

describe('ExerciseForm — create (TL-19)', () => {
  it('submit create gửi payload đúng (lessonId/topicId) và gọi onSaved(id)', async () => {
    const fetchMock = stubFetch(200, {
      success: true,
      data: { exercise: { id: 99 } },
    });
    const { onSaved } = renderCreate(7);
    fillValidMcq();
    fireEvent.change(screen.getByLabelText('Chủ đề'), {
      target: { value: '9' },
    });
    submitCreate();

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(99));
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/admin/exercises');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
    expect(init?.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual({
      type: 'mcq',
      prompt: 'Chọn đáp án đúng',
      content: {
        options: [
          { id: 'opt-1', text: 'A' },
          { id: 'opt-2', text: 'B' },
        ],
      },
      answer: { optionId: 'opt-1' },
      explanation: null,
      orderIndex: 3,
      mediaId: null,
      lessonId: 7,
      topicId: 9,
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it('create không chọn chủ đề → topicId null', async () => {
    const fetchMock = stubFetch(200, {
      success: true,
      data: { exercise: { id: 100 } },
    });
    renderCreate(7);
    fillValidMcq();
    submitCreate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({ topicId: null });
  });

  it('thêm/xoá lựa chọn giữ id ổn định và dùng opt-n nhỏ nhất chưa dùng', async () => {
    const fetchMock = stubFetch(200, {
      success: true,
      data: { exercise: { id: 101 } },
    });
    renderCreate(7);
    fillValidMcq();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm lựa chọn' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm lựa chọn' }));
    fireEvent.change(screen.getByLabelText('Lựa chọn 3'), {
      target: { value: 'C' },
    });
    fireEvent.change(screen.getByLabelText('Lựa chọn 4'), {
      target: { value: 'D' },
    });
    // X5: xoá opt-2 rồi thêm mới không tái sử dụng id đã cấp trong phiên.
    fireEvent.click(screen.getByRole('button', { name: 'Xoá lựa chọn 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm lựa chọn' }));
    fireEvent.change(screen.getByLabelText('Lựa chọn 4'), {
      target: { value: 'E' },
    });
    submitCreate();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as {
      content: { options: { id: string; text: string }[] };
    };
    expect(body.content.options).toEqual([
      { id: 'opt-1', text: 'A' },
      { id: 'opt-3', text: 'C' },
      { id: 'opt-4', text: 'D' },
      { id: 'opt-5', text: 'E' },
    ]);
    expect(new Set(body.content.options.map((option) => option.id)).size).toBe(
      4,
    );
  });

  it('đổi loại xoá state phần riêng của loại cũ và hiện câu báo', () => {
    renderCreate(7);
    fireEvent.change(screen.getByLabelText('Lựa chọn 1'), {
      target: { value: 'A' },
    });
    fireEvent.change(screen.getByLabelText('Lựa chọn 2'), {
      target: { value: 'B' },
    });

    fireEvent.change(screen.getByLabelText('Loại bài tập *'), {
      target: { value: 'fill_blank' },
    });
    expect(screen.queryByLabelText('Lựa chọn 1')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Đáp án chấp nhận 1')).toHaveValue('');
    expect(
      screen.getByText(/Phần riêng của loại trước đã được đặt lại/),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Loại bài tập *'), {
      target: { value: 'mcq' },
    });
    expect(screen.getByLabelText('Lựa chọn 1')).toHaveValue('');
    expect(screen.getByLabelText('Lựa chọn 2')).toHaveValue('');

    fireEvent.change(screen.getByLabelText('Loại bài tập *'), {
      target: { value: 'listening_choice' },
    });
    expect(screen.getByLabelText('Audio *')).toBeInTheDocument();
    expect(
      screen.getByText(/Phần riêng của loại trước đã được đặt lại/),
    ).toHaveTextContent(EXERCISE_FORM_MESSAGE.audioRequired);
  });

  it('sắp xếp câu: thêm/xoá/di chuyển mảnh giữ id và tokenOrder đúng', async () => {
    const fetchMock = stubFetch(200, {
      success: true,
      data: { exercise: { id: 102 } },
    });
    renderCreate(7);
    fireEvent.change(screen.getByLabelText('Loại bài tập *'), {
      target: { value: 'arrange_sentence' },
    });
    fireEvent.change(screen.getByLabelText('Đề bài *'), {
      target: { value: 'Sắp xếp câu' },
    });
    fireEvent.change(screen.getByLabelText('Thứ tự *'), {
      target: { value: '4' },
    });
    fireEvent.change(screen.getByLabelText('Mảnh câu 1'), {
      target: { value: 'Tôi' },
    });
    fireEvent.change(screen.getByLabelText('Mảnh câu 2'), {
      target: { value: 'đi' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm mảnh' }));
    fireEvent.change(screen.getByLabelText('Mảnh câu 3'), {
      target: { value: 'học' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Đưa mảnh 3 lên' }));
    submitCreate();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as {
      content: { tokens: { id: string; text: string }[] };
      answer: { tokenIds: string[] };
    };
    // X1: câu trả lời giữ thứ tự soạn, hiển thị bị xáo (cùng tập id).
    expect(body.answer).toEqual({ tokenIds: ['tok-1', 'tok-3', 'tok-2'] });
    expect(body.content.tokens.map((token) => token.id).sort()).toEqual([
      'tok-1',
      'tok-2',
      'tok-3',
    ]);
    expect(body.content.tokens.map((token) => token.id)).not.toEqual([
      'tok-1',
      'tok-3',
      'tok-2',
    ]);
    const texts = new Map(
      body.content.tokens.map((token) => [token.id, token.text]),
    );
    expect(texts.get('tok-1')).toBe('Tôi');
    expect(texts.get('tok-2')).toBe('đi');
    expect(texts.get('tok-3')).toBe('học');
  });

  it('xoá mảnh câu rồi thêm lại dùng tok-n nhỏ nhất chưa dùng', async () => {
    const fetchMock = stubFetch(200, {
      success: true,
      data: { exercise: { id: 103 } },
    });
    renderCreate(7);
    fireEvent.change(screen.getByLabelText('Loại bài tập *'), {
      target: { value: 'arrange_sentence' },
    });
    fireEvent.change(screen.getByLabelText('Đề bài *'), {
      target: { value: 'Sắp xếp câu' },
    });
    fireEvent.change(screen.getByLabelText('Thứ tự *'), {
      target: { value: '4' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm mảnh' }));
    fireEvent.change(screen.getByLabelText('Mảnh câu 1'), {
      target: { value: 'một' },
    });
    fireEvent.change(screen.getByLabelText('Mảnh câu 2'), {
      target: { value: 'hai' },
    });
    fireEvent.change(screen.getByLabelText('Mảnh câu 3'), {
      target: { value: 'ba' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xoá mảnh 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm mảnh' }));
    fireEvent.change(screen.getByLabelText('Mảnh câu 3'), {
      target: { value: 'một' },
    });
    submitCreate();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as {
      content: { tokens: { id: string; text: string }[] };
      answer: { tokenIds: string[] };
    };
    // X5: id mới tok-4 (tok-1 đã cấp trong phiên); nội dung hiển thị bị xáo.
    expect(body.answer).toEqual({ tokenIds: ['tok-2', 'tok-3', 'tok-4'] });
    expect(body.content.tokens.map((token) => token.id).sort()).toEqual([
      'tok-2',
      'tok-3',
      'tok-4',
    ]);
    const texts = new Map(
      body.content.tokens.map((token) => [token.id, token.text]),
    );
    expect(texts.get('tok-2')).toBe('hai');
    expect(texts.get('tok-3')).toBe('ba');
    expect(texts.get('tok-4')).toBe('một');
  });

  it('kiểm client: focus ô lỗi đầu tiên theo thứ tự và aria-describedby', () => {
    const fetchMock = stubFetch(200);
    renderCreate(7);
    submitCreate();

    const prompt = screen.getByLabelText('Đề bài *');
    expect(prompt).toHaveFocus();
    expect(prompt).toHaveAttribute('aria-invalid', 'true');
    expect(prompt).toHaveAttribute(
      'aria-describedby',
      'exercise-form-prompt-error',
    );
    expect(
      document.getElementById('exercise-form-prompt-error'),
    ).toHaveTextContent(EXERCISE_FORM_MESSAGE.promptRequired);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(prompt, { target: { value: 'Đề bài mới' } });
    submitCreate();
    const order = screen.getByLabelText('Thứ tự *');
    expect(order).toHaveFocus();
    expect(order).toHaveAttribute(
      'aria-describedby',
      'exercise-form-order-error',
    );

    fireEvent.change(order, { target: { value: '0' } });
    submitCreate();
    expect(order).toHaveFocus();
    expect(order).toHaveAttribute('aria-invalid', 'true');
  });

  it('create không có ?lessonId= phải chọn bài học trước khi gửi', () => {
    const fetchMock = stubFetch(200);
    renderCreate(null);
    fillValidMcq();
    submitCreate();
    expect(screen.getByText('Chọn bài học.')).toBeInTheDocument();
    expect(screen.getByLabelText('Bài học *')).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('422 content.options[1].text gắn lỗi đúng lựa chọn thứ 2', async () => {
    stubFetch(422, {
      success: false,
      error: {
        status: 422,
        code: 'non_empty_string_required',
        details: { path: 'content.options[1].text' },
      },
    });
    renderCreate(7);
    fillValidMcq();
    submitCreate();

    const error = await screen.findByText('Trường này không được để trống.');
    expect(error).toHaveAttribute('id', 'exercise-form-option-opt-2-error');
    const second = screen.getByLabelText('Lựa chọn 2');
    expect(second).toHaveAttribute('aria-invalid', 'true');
    expect(second).toHaveAttribute(
      'aria-describedby',
      'exercise-form-option-opt-2-error',
    );
    expect(second).toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('422 listening_media_not_ready không path → vùng lỗi chung', async () => {
    const fetchMock = stubFetch(422, {
      success: false,
      error: { status: 422, code: 'listening_media_not_ready' },
    });
    renderCreate(7);
    fireEvent.change(screen.getByLabelText('Loại bài tập *'), {
      target: { value: 'listening_choice' },
    });
    fillValidMcq();
    fireEvent.change(screen.getByLabelText('Audio *'), {
      target: { value: '5' },
    });
    submitCreate();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Audio phải sẵn sàng và chưa bị xoá.');
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({ mediaId: 5 });
  });
});

describe('ExerciseForm — edit (TL-15, TL-18)', () => {
  it('prefill và hiển thị bài học/chủ đề chỉ đọc', () => {
    renderEdit();
    expect(screen.getByLabelText('Đề bài *')).toHaveValue('Đề bài cũ');
    expect(screen.getByLabelText('Lựa chọn 1')).toHaveValue('A');
    expect(screen.getByLabelText('Đáp án đúng cho lựa chọn 1')).toBeChecked();
    expect(screen.getByText('Bài 12: Du lịch')).toBeInTheDocument();
    expect(screen.getByText('Chủ đề A')).toBeInTheDocument();
    expect(screen.queryByLabelText('Bài học *')).not.toBeInTheDocument();
  });

  it('submit edit gửi đúng submitPath, không có lessonId/topicId và gọi onSaved()', async () => {
    const fetchMock = stubFetch(200, {
      success: true,
      data: { revision: { id: 77 } },
    });
    const { onSaved } = renderEdit();
    fireEvent.change(screen.getByLabelText('Đề bài *'), {
      target: { value: 'Đề bài mới' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản sửa' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith());
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/admin/exercises/41/revisions');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      type: 'mcq',
      prompt: 'Đề bài mới',
      content: {
        options: [
          { id: 'opt-1', text: 'A' },
          { id: 'opt-2', text: 'B' },
        ],
      },
      answer: { optionId: 'opt-1' },
      explanation: null,
      orderIndex: 3,
      mediaId: null,
    });
    expect(body).not.toHaveProperty('lessonId');
    expect(body).not.toHaveProperty('topicId');
  });

  it('archived khoá toàn bộ input/button và hiện câu chỉ xem', () => {
    renderEdit({ archived: true });
    expect(
      screen.getByText('Bài tập đã lưu trữ, chỉ xem.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Đề bài *')).toBeDisabled();
    expect(screen.getByLabelText('Lựa chọn 1')).toBeDisabled();
    expect(screen.getByLabelText('Thứ tự *')).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Thêm lựa chọn' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Lưu bản sửa' })).toBeDisabled();
  });

  it('401 → replace login; 403 → câu quyền; 409 → câu xung đột', async () => {
    stubFetch(401, { success: false, error: { code: 'UNAUTHORIZED' } });
    const first = renderEdit();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản sửa' }));
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(SESSION_LOGIN_PATH),
    );
    first.unmount();

    stubFetch(403, { success: false, error: { code: 'FORBIDDEN' } });
    const second = renderEdit();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản sửa' }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
    second.unmount();

    stubFetch(409, {
      success: false,
      error: { status: 409, code: 'TOPIC_LESSON_MISMATCH' },
    });
    renderEdit();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản sửa' }));
    expect(
      await screen.findByText(contentConflictMessage('TOPIC_LESSON_MISMATCH')),
    ).toBeInTheDocument();
  });

  it('X5: xoá opt-3/tok-3 rồi thêm lại không tái dùng id đã cấp trong phiên', () => {
    stubFetch(200, { success: true, data: { exercise: { id: 150 } } });
    renderCreate(7);
    // Lựa chọn: thêm opt-3, xoá opt-3, thêm mới → không phải opt-3.
    fireEvent.click(screen.getByRole('button', { name: 'Thêm lựa chọn' }));
    expect(screen.getByLabelText('Lựa chọn 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xoá lựa chọn 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm lựa chọn' }));
    expect(screen.getByLabelText('Lựa chọn 3')).toBeInTheDocument();
    expect(document.getElementById('exercise-form-option-opt-3')).toBeNull();
    expect(
      document.getElementById('exercise-form-option-opt-4'),
    ).not.toBeNull();

    // Mảnh câu: tương tự với tok-.
    fireEvent.change(screen.getByLabelText('Loại bài tập *'), {
      target: { value: 'arrange_sentence' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm mảnh' }));
    expect(screen.getByLabelText('Mảnh câu 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xoá mảnh 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm mảnh' }));
    expect(document.getElementById('exercise-form-token-tok-4')).not.toBeNull();
  });

  it('X3: nút Xoá có aria-label theo mục (lựa chọn/đáp án/mảnh)', () => {
    renderCreate(7);
    expect(
      screen.getByRole('button', { name: 'Xoá lựa chọn 1' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Xoá lựa chọn 2' }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Loại bài tập *'), {
      target: { value: 'fill_blank' },
    });
    expect(
      screen.getByRole('button', { name: 'Xoá đáp án 1' }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Loại bài tập *'), {
      target: { value: 'arrange_sentence' },
    });
    expect(
      screen.getByRole('button', { name: 'Xoá mảnh 1' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Xoá mảnh 2' }),
    ).toBeInTheDocument();
  });

  it('X4: câu báo đổi loại nằm trong vùng role="status" có sẵn trong DOM', () => {
    renderCreate(7);
    // Vùng status tồn tại ngay từ đầu (nội dung rỗng).
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('');
    fireEvent.change(screen.getByLabelText('Loại bài tập *'), {
      target: { value: 'fill_blank' },
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      /Phần riêng của loại trước đã được đặt lại/,
    );
    fireEvent.change(screen.getByLabelText('Loại bài tập *'), {
      target: { value: 'listening_choice' },
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      EXERCISE_FORM_MESSAGE.audioRequired,
    );
    // Chỉ một vùng status duy nhất.
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('X1: sửa chỉ đề bài giữ nguyên thứ tự hiển thị content.tokens đã lưu', async () => {
    const fetchMock = stubFetch(200, { success: true, data: {} });
    const initial: ExerciseFormValue = {
      ...editInitial,
      type: 'arrange_sentence',
      tokens: [
        { id: 'tok-2', text: '想' },
        { id: 'tok-1', text: '我' },
        { id: 'tok-3', text: '去' },
      ],
      tokenOrder: ['tok-2', 'tok-1', 'tok-3'],
      tokenDisplayOrder: ['tok-3', 'tok-1', 'tok-2'],
      options: [],
      correctOptionId: '',
    };
    renderEdit({ initial });
    fireEvent.change(screen.getByLabelText('Đề bài *'), {
      target: { value: 'Đề bài mới' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản sửa' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as {
      content: { tokens: { id: string; text: string }[] };
      answer: { tokenIds: string[] };
    };
    expect(body.content.tokens.map((token) => token.id)).toEqual([
      'tok-3',
      'tok-1',
      'tok-2',
    ]);
    expect(body.answer).toEqual({ tokenIds: ['tok-2', 'tok-1', 'tok-3'] });
  });

  it('X11: lưu bản sửa thành công → role="status" báo đã lưu và xoá câu báo đổi loại', async () => {
    const fetchMock = stubFetch(200, { success: true, data: {} });
    const { onSaved } = renderEdit();
    fireEvent.change(screen.getByLabelText('Loại bài tập *'), {
      target: { value: 'fill_blank' },
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      /Phần riêng của loại trước đã được đặt lại/,
    );
    fireEvent.change(screen.getByLabelText('Đề bài *'), {
      target: { value: 'Điền từ mới' },
    });
    fireEvent.change(screen.getByLabelText('Đáp án chấp nhận 1'), {
      target: { value: '好' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản sửa' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith());
    expect(screen.getByRole('status')).toHaveTextContent('Đã lưu bản sửa.');
    expect(screen.getByRole('status')).not.toHaveTextContent(
      /Phần riêng của loại trước/,
    );
    expect(fetchMock).toHaveBeenCalled();
  });

  it('Y3: dữ liệu cũ có thứ tự hiển thị trùng đáp án → lưu 2 lần, content.tokens giống hệt', async () => {
    const fetchMock = stubFetchSequence([{ status: 200 }, { status: 200 }]);
    const initial: ExerciseFormValue = {
      ...editInitial,
      type: 'arrange_sentence',
      prompt: 'Câu cũ',
      tokens: [
        { id: 'tok-1', text: '我' },
        { id: 'tok-2', text: '想' },
        { id: 'tok-3', text: '去' },
      ],
      tokenOrder: ['tok-1', 'tok-2', 'tok-3'],
      // Dữ liệu cũ: thứ tự hiển thị trùng thứ tự đáp án.
      tokenDisplayOrder: ['tok-1', 'tok-2', 'tok-3'],
      options: [],
      correctOptionId: '',
    };
    const { onSaved } = renderEdit({ initial });
    fireEvent.change(screen.getByLabelText('Đề bài *'), {
      target: { value: 'Đề lần 1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản sửa' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const first = fetchBody(fetchMock, 0);
    // Lần đầu xáo lại vì thứ tự cũ trùng đáp án.
    expect(first.content.tokens.map((token) => token.id)).not.toEqual([
      'tok-1',
      'tok-2',
      'tok-3',
    ]);

    fireEvent.change(screen.getByLabelText('Đề bài *'), {
      target: { value: 'Đề lần 2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản sửa' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
    const second = fetchBody(fetchMock, 1);
    // Y3: lần hai giữ đúng thứ tự hiển thị vừa lưu, không xáo lại.
    expect(second.content).toEqual(first.content);
    expect(second.answer).toEqual(first.answer);
  });

  it('Y5: lưu thành công rồi lần gửi sau 422 → không còn câu "Đã lưu bản sửa."', async () => {
    const fetchMock = stubFetchSequence([
      { status: 200 },
      { status: 422, body: { error: { code: 'prompt_required' } } },
    ]);
    const { onSaved } = renderEdit();
    fireEvent.change(screen.getByLabelText('Đề bài *'), {
      target: { value: 'Đề mới' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản sửa' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status')).toHaveTextContent('Đã lưu bản sửa.');

    fireEvent.click(screen.getByRole('button', { name: 'Lưu bản sửa' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('alert')).toBeVisible());
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});

describe('X8 — kiểm client theo loại (chữ cạnh ô, aria-describedby, focus ô lỗi đầu)', () => {
  function submitAndExpectFocus(
    focusElement: HTMLElement,
    errorId: string,
    message: string,
  ) {
    submitCreate();
    expect(focusElement).toHaveFocus();
    expect(focusElement).toHaveAttribute('aria-invalid', 'true');
    expect(focusElement).toHaveAttribute('aria-describedby', errorId);
    expect(document.getElementById(errorId)).toHaveTextContent(message);
  }

  it('thiếu đáp án đúng → lỗi cạnh nhóm lựa chọn, focus radio đầu', () => {
    const fetchMock = stubFetch(200);
    renderCreate(7);
    fireEvent.change(screen.getByLabelText('Đề bài *'), {
      target: { value: 'Chọn đáp án' },
    });
    fireEvent.change(screen.getByLabelText('Thứ tự *'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByLabelText('Lựa chọn 1'), {
      target: { value: 'A' },
    });
    fireEvent.change(screen.getByLabelText('Lựa chọn 2'), {
      target: { value: 'B' },
    });
    submitCreate();
    expect(screen.getByLabelText('Đáp án đúng cho lựa chọn 1')).toHaveFocus();
    expect(
      document.getElementById('exercise-form-correct-error'),
    ).toHaveTextContent(EXERCISE_FORM_MESSAGE.correctAnswerRequired);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lựa chọn trống → lỗi cạnh đúng lựa chọn đó, focus ô trống đầu tiên', () => {
    const fetchMock = stubFetch(200);
    renderCreate(7);
    fireEvent.change(screen.getByLabelText('Đề bài *'), {
      target: { value: 'Chọn đáp án' },
    });
    fireEvent.change(screen.getByLabelText('Thứ tự *'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByLabelText('Lựa chọn 1'), {
      target: { value: 'A' },
    });
    submitCreate();
    const second = screen.getByLabelText('Lựa chọn 2');
    submitAndExpectFocus(
      second,
      'exercise-form-option-opt-2-error',
      EXERCISE_FORM_MESSAGE.optionTextRequired,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('< 2 lựa chọn → lỗi số lượng, focus lựa chọn đầu', () => {
    const fetchMock = stubFetch(200);
    renderCreate(7);
    fireEvent.change(screen.getByLabelText('Đề bài *'), {
      target: { value: 'Chọn đáp án' },
    });
    fireEvent.change(screen.getByLabelText('Thứ tự *'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByLabelText('Lựa chọn 1'), {
      target: { value: 'A' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xoá lựa chọn 2' }));
    submitCreate();
    expect(screen.getByLabelText('Lựa chọn 1')).toHaveFocus();
    expect(
      document.getElementById('exercise-form-options-error'),
    ).toHaveTextContent(EXERCISE_FORM_MESSAGE.optionsRange);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('đáp án chấp nhận trống → lỗi cạnh ô đáp án, focus ô đó', () => {
    const fetchMock = stubFetch(200);
    renderCreate(7);
    fireEvent.change(screen.getByLabelText('Loại bài tập *'), {
      target: { value: 'fill_blank' },
    });
    fireEvent.change(screen.getByLabelText('Đề bài *'), {
      target: { value: 'Điền từ' },
    });
    fireEvent.change(screen.getByLabelText('Thứ tự *'), {
      target: { value: '2' },
    });
    submitCreate();
    submitAndExpectFocus(
      screen.getByLabelText('Đáp án chấp nhận 1'),
      'exercise-form-accepted-0-error',
      EXERCISE_FORM_MESSAGE.acceptedTextRequired,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('< 2 mảnh câu → lỗi số lượng, focus mảnh đầu', () => {
    const fetchMock = stubFetch(200);
    renderCreate(7);
    fireEvent.change(screen.getByLabelText('Loại bài tập *'), {
      target: { value: 'arrange_sentence' },
    });
    fireEvent.change(screen.getByLabelText('Đề bài *'), {
      target: { value: 'Sắp xếp' },
    });
    fireEvent.change(screen.getByLabelText('Thứ tự *'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xoá mảnh 2' }));
    submitCreate();
    expect(screen.getByLabelText('Mảnh câu 1')).toHaveFocus();
    expect(
      document.getElementById('exercise-form-tokens-error'),
    ).toHaveTextContent(EXERCISE_FORM_MESSAGE.tokensRange);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('đề bài > 4096 ký tự → lỗi cạnh ô đề bài, focus ô đề bài', () => {
    const fetchMock = stubFetch(200);
    renderCreate(7);
    fireEvent.change(screen.getByLabelText('Đề bài *'), {
      target: { value: 'a'.repeat(4_097) },
    });
    fireEvent.change(screen.getByLabelText('Thứ tự *'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByLabelText('Lựa chọn 1'), {
      target: { value: 'A' },
    });
    fireEvent.change(screen.getByLabelText('Lựa chọn 2'), {
      target: { value: 'B' },
    });
    fireEvent.click(screen.getByLabelText('Đáp án đúng cho lựa chọn 1'));
    submitCreate();
    expect(screen.getByLabelText('Đề bài *')).toHaveFocus();
    expect(
      document.getElementById('exercise-form-prompt-error'),
    ).toHaveTextContent(EXERCISE_FORM_MESSAGE.promptRequired);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('nghe chọn thiếu audio → lỗi cạnh ô Audio, focus ô Audio', () => {
    const fetchMock = stubFetch(200);
    renderCreate(7);
    fireEvent.change(screen.getByLabelText('Loại bài tập *'), {
      target: { value: 'listening_choice' },
    });
    fireEvent.change(screen.getByLabelText('Đề bài *'), {
      target: { value: 'Nghe chọn' },
    });
    fireEvent.change(screen.getByLabelText('Thứ tự *'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByLabelText('Lựa chọn 1'), {
      target: { value: 'mā' },
    });
    fireEvent.change(screen.getByLabelText('Lựa chọn 2'), {
      target: { value: 'má' },
    });
    fireEvent.click(screen.getByLabelText('Đáp án đúng cho lựa chọn 1'));
    submitCreate();
    const audioSelect = screen.getByLabelText('Audio *');
    expect(audioSelect).toHaveFocus();
    expect(audioSelect).toHaveAttribute('aria-invalid', 'true');
    expect(audioSelect).toHaveAttribute(
      'aria-describedby',
      'exercise-form-audio-error',
    );
    expect(
      document.getElementById('exercise-form-audio-error'),
    ).toHaveTextContent(EXERCISE_FORM_MESSAGE.audioRequired);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mảnh câu rỗng → lỗi cạnh đúng mảnh, focus ô đó', () => {
    const fetchMock = stubFetch(200);
    renderCreate(7);
    fireEvent.change(screen.getByLabelText('Loại bài tập *'), {
      target: { value: 'arrange_sentence' },
    });
    fireEvent.change(screen.getByLabelText('Đề bài *'), {
      target: { value: 'Sắp xếp' },
    });
    fireEvent.change(screen.getByLabelText('Thứ tự *'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByLabelText('Mảnh câu 1'), {
      target: { value: '我' },
    });
    submitCreate();
    const second = screen.getByLabelText('Mảnh câu 2');
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute('aria-invalid', 'true');
    expect(second).toHaveAttribute(
      'aria-describedby',
      'exercise-form-token-tok-2-error',
    );
    expect(
      document.getElementById('exercise-form-token-tok-2-error'),
    ).toHaveTextContent(EXERCISE_FORM_MESSAGE.tokenTextRequired);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('câu mẫu > 4096 ký tự → lỗi cạnh ô câu mẫu, focus ô đó', () => {
    const fetchMock = stubFetch(200);
    renderCreate(7);
    fireEvent.change(screen.getByLabelText('Loại bài tập *'), {
      target: { value: 'speaking_repeat' },
    });
    fireEvent.change(screen.getByLabelText('Đề bài *'), {
      target: { value: 'Luyện nói' },
    });
    fireEvent.change(screen.getByLabelText('Thứ tự *'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByLabelText('Câu mẫu'), {
      target: { value: 'a'.repeat(4_097) },
    });
    submitCreate();
    const reference = screen.getByLabelText('Câu mẫu');
    expect(reference).toHaveFocus();
    expect(reference).toHaveAttribute('aria-invalid', 'true');
    expect(reference).toHaveAttribute(
      'aria-describedby',
      'exercise-form-reference-error',
    );
    expect(
      document.getElementById('exercise-form-reference-error'),
    ).toHaveTextContent(EXERCISE_FORM_MESSAGE.referenceTextTooLong);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
