import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
}));

import { ExerciseImportScreen } from './exercise-import-screen';

const SOURCES = [
  {
    id: 11,
    code: 'FRONTEND_CONSOLE_V1',
    name: 'Nguồn console',
    version: 'v1',
  },
  {
    id: 12,
    code: 'CC_CEDICT_2026_05_04',
    name: 'CC-CEDICT',
    version: '2026-05-04',
  },
];

const PREVIEW_HASH = 'a'.repeat(64);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function previewBody(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      totalRows: 2,
      validRows: 2,
      invalidRows: 0,
      errors: [],
      errorsTotal: 0,
      previewHash: PREVIEW_HASH,
      ...overrides,
    },
  };
}

function commitBody(importedRows = 2) {
  return {
    success: true,
    data: {
      importedRows,
      exercises: Array.from({ length: importedRows }, (_, index) => ({
        id: 41 + index,
      })),
    },
  };
}

function failureBody(code: string, errors: unknown[] = []) {
  return {
    success: false,
    error: {
      code,
      message: 'backend message',
      ...(errors.length > 0 ? { details: { errors } } : {}),
    },
  };
}

function fileOf(rows: unknown[], name = 'bai-tap.json'): File {
  return new File([JSON.stringify(rows)], name, { type: 'application/json' });
}

function renderScreen(dataSources = SOURCES) {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  render(<ExerciseImportScreen dataSources={dataSources} />);
  return fetchMock;
}

function sourceSelect() {
  return screen.getByLabelText(/Nguồn dữ liệu/u);
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('#import-file');
  if (!(input instanceof HTMLInputElement)) throw new Error('missing input');
  return input;
}

function previewButton() {
  return screen.getByRole('button', { name: /Xem trước & kiểm tra/u });
}

function commitButton() {
  return screen.getByRole('button', { name: /^Nhập dữ liệu$/u });
}

/** W4: mọi id trong aria-describedby phải trỏ tới phần tử đang có trong DOM. */
function expectDescribedByTargetsExist() {
  const elements = Array.from(document.querySelectorAll('[aria-describedby]'));
  for (const element of elements) {
    const ids = (element.getAttribute('aria-describedby') ?? '')
      .split(/\s+/u)
      .filter(Boolean);
    for (const id of ids) {
      expect(
        document.getElementById(id),
        `aria-describedby tới #${id} không tồn tại (${element.outerHTML.slice(0, 80)})`,
      ).not.toBeNull();
    }
  }
}

async function chooseSource(value = '11') {
  const user = userEvent.setup();
  await user.selectOptions(sourceSelect(), value);
  return user;
}

async function chooseSourceAndFile(
  file: File = fileOf([{ sourceKey: 'a' }]),
  source = '11',
) {
  const user = await chooseSource(source);
  await user.upload(fileInput(), file);
  await waitFor(() =>
    expect(document.querySelector('.adm-import-file__name')).not.toBeNull(),
  );
  return user;
}

afterEach(() => {
  vi.unstubAllGlobals();
  pushMock.mockReset();
});

describe('ExerciseImportScreen (M5.1b2; Z1–Z8, Z11, Z13)', () => {
  it('Q100 + Z7: danh sách nguồn rỗng → câu báo, khoá select/tệp, lý do ngắn duy nhất', () => {
    renderScreen([]);
    expect(
      screen.getByText(/Liên hệ quản trị hệ thống để thêm nguồn/u),
    ).toBeInTheDocument();
    expect(sourceSelect()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Chọn tệp' })).toBeDisabled();
    expect(fileInput()).toBeDisabled();
    // Z7: nút tắt có đúng một câu lý do, nối bằng aria-describedby.
    expect(previewButton()).toHaveAttribute(
      'aria-describedby',
      'import-preview-hint',
    );
    expect(commitButton()).toHaveAttribute(
      'aria-describedby',
      'import-preview-hint',
    );
    expect(document.querySelector('#import-preview-hint')?.textContent).toBe(
      'Chưa có nguồn dữ liệu.',
    );
    expect(document.querySelector('#import-commit-hint')).toBeNull();
    expect(document.querySelectorAll('.adm-import-hint')).toHaveLength(1);
  });

  it('Z7: lý do theo trạng thái thiếu nguồn/tệp, nối aria-describedby cho từng nút', () => {
    renderScreen();
    expect(previewButton()).toHaveAttribute(
      'aria-describedby',
      'import-preview-hint',
    );
    expect(document.querySelector('#import-preview-hint')?.textContent).toBe(
      'Chọn nguồn dữ liệu và tệp .json để xem trước.',
    );
    expect(commitButton()).toHaveAttribute(
      'aria-describedby',
      'import-commit-hint',
    );
    expect(document.querySelector('#import-commit-hint')?.textContent).toBe(
      'Cần xem trước không có lỗi trước khi nhập.',
    );
  });

  it('Z13: đã có tệp chỉ hiện "Chọn tệp khác"; dòng nhắc Q101 dưới ô nguồn', async () => {
    renderScreen();
    expect(
      screen.getByText(
        'Chọn đúng nguồn biên soạn của bài tập; nguồn mới do quản trị hệ thống thêm.',
      ),
    ).toBeInTheDocument();
    expect(sourceSelect()).toHaveAttribute(
      'aria-describedby',
      'import-source-help',
    );
    await chooseSourceAndFile();
    expect(screen.queryByRole('button', { name: 'Chọn tệp' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Chọn tệp khác' }),
    ).toBeInTheDocument();
  });

  it('báo lỗi cấu trúc tệp (quá 100 dòng) và không gọi preview', async () => {
    const fetchMock = renderScreen();
    const rows = Array.from({ length: 101 }, (_, index) => ({
      sourceKey: `row-${index + 1}`,
    }));
    const user = await chooseSource();
    await user.upload(fileInput(), fileOf(rows));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('quá 100 dòng'),
    );
    expect(previewButton()).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Z3: tệp > 90 000 byte bị chặn TRƯỚC khi đọc nội dung', async () => {
    const fetchMock = renderScreen();
    const textSpy = vi.spyOn(File.prototype, 'text');
    const big = new File([new Uint8Array(90_001)], 'big.json', {
      type: 'application/json',
    });
    const user = await chooseSource();
    await user.upload(fileInput(), big);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Tệp tối đa 90 KB.'),
    );
    expect(textSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Z3: chọn tệp lần sau thắng khi lần đọc trước về muộn', async () => {
    renderScreen();
    const user = await chooseSource();
    let resolveSlow!: (value: string) => void;
    const slow = new File(
      [JSON.stringify([{ sourceKey: 'slow' }])],
      'slow.json',
      {
        type: 'application/json',
      },
    );
    Object.defineProperty(slow, 'text', {
      value: () =>
        new Promise<string>((resolve) => {
          resolveSlow = resolve;
        }),
    });
    const fast = fileOf([{ sourceKey: 'fast' }], 'fast.json');
    await user.upload(fileInput(), slow);
    await user.upload(fileInput(), fast);
    await waitFor(() =>
      expect(
        document.querySelector('.adm-import-file__name')?.textContent,
      ).toContain('fast.json'),
    );
    await act(async () => {
      resolveSlow(JSON.stringify([{ sourceKey: 'slow' }]));
    });
    expect(
      document.querySelector('.adm-import-file__name')?.textContent,
    ).toContain('fast.json');
  });

  it('preview có lỗi → bảng lỗi đúng dòng/nhãn, nút Nhập dữ liệu tắt (Z5: bảng ngoài live region)', async () => {
    const fetchMock = renderScreen();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        previewBody({
          validRows: 0,
          invalidRows: 2,
          errorsTotal: 2,
          errors: [
            {
              rowNumber: 1,
              code: 'SOURCE_KEY_ALREADY_EXISTS',
              path: 'sourceKey',
            },
            { rowNumber: 2, code: 'ROGUE_CODE', path: 'lessonId' },
          ],
        }),
      ),
    );
    const user = await chooseSourceAndFile();
    await user.click(previewButton());
    await waitFor(() =>
      expect(screen.getByText('Kết quả kiểm tra')).toBeVisible(),
    );
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('1');
    expect(rows[1]).toHaveTextContent('Nguồn đã có bài tập với mã nguồn này.');
    expect(rows[2]).toHaveTextContent('ROGUE_CODE');
    expect(commitButton()).toBeDisabled();
    expect(table.closest('[aria-live]')).toBeNull();
    expect(
      document.querySelector('.adm-import-stats')?.closest('[aria-live]'),
    ).toBeNull();
    // Z13: caption bảng sr-only.
    expect(table.querySelector('caption')).toHaveClass('sr-only');
  });

  it('Z1: 250 lỗi → bảng 100 lỗi đầu + câu "Hiện 100 lỗi đầu trong 250 lỗi."', async () => {
    const fetchMock = renderScreen();
    const errors = Array.from({ length: 100 }, (_, index) => ({
      rowNumber: index + 1,
      code: 'REQUIRED_FIELD',
      path: 'prompt',
    }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        previewBody({
          validRows: 0,
          invalidRows: 100,
          errors,
          errorsTotal: 250,
        }),
      ),
    );
    const user = await chooseSourceAndFile();
    await user.click(previewButton());
    await waitFor(() =>
      expect(screen.getByText('Hiện 100 lỗi đầu trong 250 lỗi.')).toBeVisible(),
    );
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(
      101,
    );
  });

  it('Z2: khi đang preview thì khoá nguồn, nút chọn tệp và ô file', async () => {
    const fetchMock = renderScreen();
    let resolvePreview!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolvePreview = resolve;
      }),
    );
    const user = await chooseSourceAndFile();
    await user.click(previewButton());
    expect(sourceSelect()).toBeDisabled();
    expect(fileInput()).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Chọn tệp khác' }),
    ).toBeDisabled();
    await act(async () => {
      resolvePreview(jsonResponse(previewBody()));
    });
    await waitFor(() => expect(commitButton()).toBeEnabled());
    expect(sourceSelect()).toBeEnabled();
  });

  it('Z2: đổi nguồn khi đang chờ → phản hồi cũ bị bỏ, nút nhập vẫn tắt', async () => {
    const fetchMock = renderScreen();
    let resolvePreview!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolvePreview = resolve;
      }),
    );
    const user = await chooseSourceAndFile();
    await user.click(previewButton());
    fireEvent.change(sourceSelect(), { target: { value: '12' } });
    await act(async () => {
      resolvePreview(jsonResponse(previewBody()));
    });
    await waitFor(() => expect(sourceSelect()).toHaveValue('12'));
    expect(screen.queryByText('Kết quả kiểm tra')).toBeNull();
    expect(commitButton()).toBeDisabled();
  });

  it('TL-28/Z2: đổi nguồn sau preview → xoá preview + key, nút nhập tắt', async () => {
    const fetchMock = renderScreen();
    fetchMock.mockResolvedValueOnce(jsonResponse(previewBody()));
    const user = await chooseSourceAndFile();
    await user.click(previewButton());
    await waitFor(() => expect(commitButton()).toBeEnabled());
    await user.selectOptions(sourceSelect(), '12');
    await waitFor(() => expect(commitButton()).toBeDisabled());
    expect(screen.queryByText('Kết quả kiểm tra')).toBeNull();
  });

  it('Z2: đổi tệp sau preview → xoá preview, nút Nhập dữ liệu tắt lại', async () => {
    const fetchMock = renderScreen();
    fetchMock.mockResolvedValueOnce(jsonResponse(previewBody()));
    const user = await chooseSourceAndFile();
    await user.click(previewButton());
    await waitFor(() => expect(commitButton()).toBeEnabled());
    await user.upload(fileInput(), fileOf([{ sourceKey: 'b' }], 'khac.json'));
    await waitFor(() => expect(commitButton()).toBeDisabled());
    expect(screen.queryByText('Kết quả kiểm tra')).toBeNull();
  });

  it('commit 503 thử lại dùng lại đúng Idempotency-Key (TL-27)', async () => {
    const fetchMock = renderScreen();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(previewBody()))
      .mockResolvedValueOnce(
        jsonResponse(failureBody('SERVICE_UNAVAILABLE'), 503),
      )
      .mockResolvedValueOnce(jsonResponse(commitBody(2)));
    const user = await chooseSourceAndFile();
    await user.click(previewButton());
    await waitFor(() => expect(commitButton()).toBeEnabled());
    await user.click(commitButton());
    await waitFor(() =>
      expect(
        screen.getByText('Không kết nối được máy chủ. Thử lại.'),
      ).toBeVisible(),
    );
    await user.click(commitButton());
    await waitFor(() =>
      expect(
        screen.getByText('Đã nhập 2 bài tập ở trạng thái Bản nháp.'),
      ).toBeVisible(),
    );

    const keys = fetchMock.mock.calls
      .slice(1)
      .map((call) =>
        new Headers((call[1] as RequestInit).headers).get('idempotency-key'),
      );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it('Z11: 413 khi preview → câu "Tệp tối đa 90 KB."', async () => {
    const fetchMock = renderScreen();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(failureBody('PAYLOAD_TOO_LARGE'), 413),
    );
    const user = await chooseSourceAndFile();
    await user.click(previewButton());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Tệp tối đa 90 KB.'),
    );
    expect(commitButton()).toBeDisabled();
  });

  it('Z11: 413 khi commit → câu "Tệp tối đa 90 KB."', async () => {
    const fetchMock = renderScreen();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(previewBody()))
      .mockResolvedValueOnce(
        jsonResponse(failureBody('PAYLOAD_TOO_LARGE'), 413),
      );
    const user = await chooseSourceAndFile();
    await user.click(previewButton());
    await waitFor(() => expect(commitButton()).toBeEnabled());
    await user.click(commitButton());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Tệp tối đa 90 KB.'),
    );
  });

  it('Z11: kéo-thả tệp hoạt động giống chọn tệp', async () => {
    renderScreen();
    await chooseSource();
    const dropZone = document.querySelector('.adm-import-drop');
    if (!(dropZone instanceof HTMLElement))
      throw new Error('missing drop zone');
    const file = fileOf([{ sourceKey: 'drop' }], 'keo-tha.json');
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });
    await waitFor(() =>
      expect(
        document.querySelector('.adm-import-file__name')?.textContent,
      ).toContain('keo-tha.json'),
    );
    expect(previewButton()).toBeEnabled();
  });

  it('422 khi commit → hiện errors + câu xem trước lại, quay bước 2', async () => {
    const fetchMock = renderScreen();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(previewBody()))
      .mockResolvedValueOnce(
        jsonResponse(
          failureBody('IMPORT_VALIDATION_FAILED', [
            {
              rowNumber: 1,
              code: 'PARENT_LESSON_NOT_FOUND',
              path: 'lessonId',
            },
          ]),
          422,
        ),
      );
    const user = await chooseSourceAndFile();
    await user.click(previewButton());
    await waitFor(() => expect(commitButton()).toBeEnabled());
    await user.click(commitButton());
    await waitFor(() =>
      expect(
        screen.getByText('Dữ liệu đã thay đổi, hãy xem trước lại.'),
      ).toBeVisible(),
    );
    expect(
      screen.getByText('Bài học không tồn tại hoặc chưa xuất bản.'),
    ).toBeVisible();
    expect(commitButton()).toBeDisabled();
    expect(
      screen.getByText('Xem trước & kiểm tra', { selector: 'li' }),
    ).toHaveAttribute('aria-current', 'step');
  });

  it('409 khi commit → câu chung và quay bước 2', async () => {
    const fetchMock = renderScreen();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(previewBody()))
      .mockResolvedValueOnce(jsonResponse(failureBody('CONFLICT'), 409));
    const user = await chooseSourceAndFile();
    await user.click(previewButton());
    await waitFor(() => expect(commitButton()).toBeEnabled());
    await user.click(commitButton());
    await waitFor(() =>
      expect(
        screen.getByText('Dữ liệu đã thay đổi, hãy xem trước lại.'),
      ).toBeVisible(),
    );
    expect(commitButton()).toBeDisabled();
  });

  it('thành công → role=status, link bài đã nhập và focus heading kết quả', async () => {
    const fetchMock = renderScreen();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(previewBody()))
      .mockResolvedValueOnce(jsonResponse(commitBody(2)));
    const user = await chooseSourceAndFile();
    await user.click(previewButton());
    await waitFor(() => expect(commitButton()).toBeEnabled());
    await user.click(commitButton());
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(
      'Đã nhập 2 bài tập ở trạng thái Bản nháp.',
    );
    expect(screen.getByRole('link', { name: 'Bài tập #41' })).toHaveAttribute(
      'href',
      '/admin/exercises/41',
    );
    expect(screen.getByRole('link', { name: 'Bài tập #42' })).toHaveAttribute(
      'href',
      '/admin/exercises/42',
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: 'Đã nhập dữ liệu' }),
      ),
    );
  });

  it('Z4: sau thành công "Nhập tệp khác" xoá tệp/preview/result, giữ nguồn, về bước 1', async () => {
    const fetchMock = renderScreen();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(previewBody()))
      .mockResolvedValueOnce(jsonResponse(commitBody(2)));
    const user = await chooseSourceAndFile();
    await user.click(previewButton());
    await waitFor(() => expect(commitButton()).toBeEnabled());
    await user.click(commitButton());
    await screen.findByRole('status');

    await user.click(screen.getByRole('button', { name: 'Nhập tệp khác' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(
      screen.queryByRole('heading', { name: 'Đã nhập dữ liệu' }),
    ).toBeNull();
    expect(document.querySelector('.adm-import-file__name')).toBeNull();
    expect(sourceSelect()).toHaveValue('11');
    expect(screen.getByText('Tải dữ liệu', { selector: 'li' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(previewButton()).toBeDisabled();
  });

  it('thành công không lồng live region (Z5)', async () => {
    const fetchMock = renderScreen();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(previewBody()))
      .mockResolvedValueOnce(jsonResponse(commitBody(1)));
    const user = await chooseSourceAndFile();
    await user.click(previewButton());
    await waitFor(() => expect(commitButton()).toBeEnabled());
    await user.click(commitButton());
    const status = await screen.findByRole('status');
    const live = status.closest('[aria-live]');
    expect(live?.querySelectorAll('[aria-live], [role="status"]')).toHaveLength(
      1,
    );
    expect(
      screen.getByRole('link', { name: 'Bài tập #41' }).closest('[aria-live]'),
    ).toBeNull();
  });
  it('W2: đang đọc tệp B thì nút xem trước tắt (không preview được tệp A)', async () => {
    renderScreen();
    const user = await chooseSourceAndFile();
    expect(previewButton()).toBeEnabled();
    let resolveSlow!: (value: string) => void;
    const slow = new File([JSON.stringify([{ sourceKey: 'b' }])], 'b.json', {
      type: 'application/json',
    });
    Object.defineProperty(slow, 'text', {
      value: () =>
        new Promise<string>((resolve) => {
          resolveSlow = resolve;
        }),
    });
    await user.upload(fileInput(), slow);
    expect(previewButton()).toBeDisabled();
    await act(async () => {
      resolveSlow(JSON.stringify([{ sourceKey: 'b' }]));
    });
    await waitFor(() =>
      expect(
        document.querySelector('.adm-import-file__name')?.textContent,
      ).toContain('b.json'),
    );
    expect(previewButton()).toBeEnabled();
  });

  it('W2: đọc tệp lỗi → "Không đọc được tệp. Chọn lại tệp." và input được xoá', async () => {
    renderScreen();
    const user = await chooseSource();
    const broken = new File(
      [JSON.stringify([{ sourceKey: 'x' }])],
      'broken.json',
      {
        type: 'application/json',
      },
    );
    Object.defineProperty(broken, 'text', {
      value: () => Promise.reject(new Error('EIO')),
    });
    await user.upload(fileInput(), broken);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Không đọc được tệp. Chọn lại tệp.',
      ),
    );
    expect(previewButton()).toBeDisabled();
    expect(fileInput().value).toBe('');
  });

  it('W2: chọn lại CÙNG tệp sau khi bị từ chối vẫn được đọc lại', async () => {
    renderScreen();
    const user = await chooseSource();
    let calls = 0;
    const flaky = new File(
      [JSON.stringify([{ sourceKey: 'x' }])],
      'flaky.json',
      {
        type: 'application/json',
      },
    );
    Object.defineProperty(flaky, 'text', {
      value: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error('EIO'))
          : Promise.resolve(JSON.stringify([{ sourceKey: 'x' }]));
      },
    });
    await user.upload(fileInput(), flaky);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Không đọc được tệp.',
      ),
    );
    await user.upload(fileInput(), flaky);
    await waitFor(() =>
      expect(
        document.querySelector('.adm-import-file__name')?.textContent,
      ).toContain('flaky.json'),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('W3: 422 commit với 1 lỗi → ẩn thẻ Kết quả kiểm tra, bảng lỗi + câu stale, không câu cắt', async () => {
    const fetchMock = renderScreen();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(previewBody()))
      .mockResolvedValueOnce(
        jsonResponse(
          failureBody('IMPORT_VALIDATION_FAILED', [
            { rowNumber: 1, code: 'PARENT_LESSON_NOT_FOUND', path: 'lessonId' },
          ]),
          422,
        ),
      );
    const user = await chooseSourceAndFile();
    await user.click(previewButton());
    await waitFor(() => expect(commitButton()).toBeEnabled());
    await user.click(commitButton());
    await waitFor(() =>
      expect(
        screen.getByText('Dữ liệu đã thay đổi, hãy xem trước lại.'),
      ).toBeVisible(),
    );
    expect(screen.queryByText('Kết quả kiểm tra')).toBeNull();
    expect(document.querySelector('.adm-import-stats')).toBeNull();
    expect(screen.getByRole('table')).toBeVisible();
    expect(document.querySelector('#import-errors-truncated')).toBeNull();
    expect(commitButton()).toBeDisabled();
  });

  it('W3: 422 commit với đúng 100 lỗi → thêm câu "Hiện 100 lỗi đầu; xem trước lại để có đủ danh sách."', async () => {
    const fetchMock = renderScreen();
    const errors = Array.from({ length: 100 }, (_, index) => ({
      rowNumber: index + 1,
      code: 'REQUIRED_FIELD',
      path: 'prompt',
    }));
    fetchMock
      .mockResolvedValueOnce(jsonResponse(previewBody()))
      .mockResolvedValueOnce(
        jsonResponse(failureBody('IMPORT_VALIDATION_FAILED', errors), 422),
      );
    const user = await chooseSourceAndFile();
    await user.click(previewButton());
    await waitFor(() => expect(commitButton()).toBeEnabled());
    await user.click(commitButton());
    await waitFor(() =>
      expect(
        screen.getByText('Hiện 100 lỗi đầu; xem trước lại để có đủ danh sách.'),
      ).toBeVisible(),
    );
    expect(screen.queryByText('Kết quả kiểm tra')).toBeNull();
    expect(document.querySelector('.adm-import-stats')).toBeNull();
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(
      101,
    );
  });

  it('W4: aria-describedby hợp lệ ở trạng thái Q100 ban đầu', () => {
    renderScreen([]);
    expectDescribedByTargetsExist();
  });

  it('W4: aria-describedby hợp lệ khi pending preview', async () => {
    const fetchMock = renderScreen();
    let resolvePreview!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolvePreview = resolve;
      }),
    );
    const user = await chooseSourceAndFile();
    await user.click(previewButton());
    expectDescribedByTargetsExist();
    await act(async () => {
      resolvePreview(jsonResponse(previewBody()));
    });
    await waitFor(() => expect(commitButton()).toBeEnabled());
  });

  it('W4: aria-describedby hợp lệ sau khi nhập thành công', async () => {
    const fetchMock = renderScreen();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(previewBody()))
      .mockResolvedValueOnce(jsonResponse(commitBody(2)));
    const user = await chooseSourceAndFile();
    await user.click(previewButton());
    await waitFor(() => expect(commitButton()).toBeEnabled());
    await user.click(commitButton());
    await screen.findByRole('status');
    expectDescribedByTargetsExist();
  });
});
