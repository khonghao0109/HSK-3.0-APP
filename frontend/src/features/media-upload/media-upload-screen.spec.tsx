import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import { MediaUploadScreen } from './media-upload-screen';

const SOURCES = [
  { id: 11, code: 'SRC_A', name: 'Nguồn A', version: 'v1' },
  { id: 12, code: 'SRC_B', name: 'Nguồn B', version: 'v2' },
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
const ok = (idempotent = false) =>
  json(
    {
      success: true,
      data: {
        idempotent,
        media: {
          id: 77,
          type: 'audio',
          mimeType: 'audio/wav',
          size: 3,
          processingStatus: 'ready',
        },
      },
    },
    201,
  );
const fail = (status: number, code?: string) =>
  json({ success: false, error: { code, message: 'x', status } }, status);

const wav = () => new File(['abc'], 'bai1.wav', { type: 'audio/x-wav' });
const fileInput = () =>
  document.getElementById('media-file') as HTMLInputElement;
const uploadButton = () => screen.getByRole('button', { name: 'Tải lên' });

let fetchMock: ReturnType<typeof vi.fn>;
let uuid = 0;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  uuid = 0;
  vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(
    () =>
      `key-${++uuid}` as `${string}-${string}-${string}-${string}-${string}`,
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function ready(file: File = wav()) {
  const user = userEvent.setup({ applyAccept: false });
  render(<MediaUploadScreen ingestionEnabled dataSources={SOURCES} />);
  await user.selectOptions(screen.getByLabelText('Nguồn dữ liệu *'), '11');
  await user.upload(fileInput(), file);
  return user;
}
const sentKey = (call: number) =>
  (fetchMock.mock.calls[call]?.[1] as RequestInit).headers as Record<
    string,
    string
  >;

describe('MediaUploadScreen', () => {
  it('starts with upload disabled and one reason', () => {
    render(<MediaUploadScreen ingestionEnabled dataSources={SOURCES} />);
    expect(uploadButton()).toBeDisabled();
    expect(uploadButton()).toHaveAttribute(
      'aria-describedby',
      'media-upload-hint',
    );
    expect(
      screen.getByText('Chọn nguồn dữ liệu và tệp để tải lên.'),
    ).toBeInTheDocument();
  });

  it('shows only the disabled notice when ingestion is off', () => {
    render(
      <MediaUploadScreen ingestionEnabled={false} dataSources={SOURCES} />,
    );
    expect(
      screen.getByText('Tính năng tải media đang tạm tắt.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Nguồn dữ liệu *')).toBeNull();
    expect(
      screen.getByRole('link', { name: 'Về thư viện media' }),
    ).toHaveAttribute('href', '/admin/media');
  });

  it('locks the form when there are no sources', () => {
    render(<MediaUploadScreen ingestionEnabled dataSources={[]} />);
    expect(screen.getByLabelText('Nguồn dữ liệu *')).toBeDisabled();
    expect(fileInput()).toBeDisabled();
    expect(uploadButton()).toHaveAttribute(
      'aria-describedby',
      'media-sources-empty',
    );
    expect(document.getElementById('media-sources-empty')).not.toBeNull();
  });

  it.each(['bai.1.wav', 'anh.jpeg'])(
    'blocks %s without fetching',
    async (name) => {
      const user = await ready(new File(['a'], name));
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(uploadButton()).toBeDisabled();
      await user.click(uploadButton());
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('sends canonical wav FormData with key and dataSourceId', async () => {
    fetchMock.mockResolvedValue(ok());
    const user = await ready();
    await user.click(uploadButton());
    await screen.findByText(/Đã tải lên bai1\.wav/);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/admin/media/ingestions?dataSourceId=11');
    expect(sentKey(0)).toEqual({ 'idempotency-key': 'key-1' });
    const part = (init.body as FormData).get('file') as File;
    expect(part.type).toBe('audio/wav');
    expect(part.name).toBe('bai1.wav');
  });

  it.each([
    ['network', () => Promise.reject(new TypeError('net'))],
    ['503 busy', () => Promise.resolve(fail(503, 'MEDIA_INGESTION_BUSY'))],
    [
      '503 timeout',
      () => Promise.resolve(fail(503, 'MEDIA_UPLOAD_BFF_TIMEOUT')),
    ],
    [
      '409 in progress',
      () => Promise.resolve(fail(409, 'MEDIA_INGESTION_IN_PROGRESS')),
    ],
  ])('keeps the key after %s', async (_label, first) => {
    fetchMock.mockImplementationOnce(first).mockResolvedValueOnce(ok());
    const user = await ready();
    await user.click(uploadButton());
    await screen.findByRole('alert');
    await user.click(uploadButton());
    await screen.findByText(/Đã tải lên/);
    expect(sentKey(1)['idempotency-key']).toBe(sentKey(0)['idempotency-key']);
  });

  it.each(['IDEMPOTENCY_KEY_IN_USE', 'IDEMPOTENCY_KEY_RENEWAL_REQUIRED'])(
    'renews the key after 409 %s',
    async (code) => {
      fetchMock
        .mockResolvedValueOnce(fail(409, code))
        .mockResolvedValueOnce(ok());
      const user = await ready();
      await user.click(uploadButton());
      await screen.findByRole('alert');
      await user.click(uploadButton());
      await screen.findByText(/Đã tải lên/);
      expect(sentKey(1)['idempotency-key']).not.toBe(
        sentKey(0)['idempotency-key'],
      );
    },
  );

  it('renews the key when the file or source changes', async () => {
    fetchMock.mockResolvedValue(fail(503, 'MEDIA_INGESTION_BUSY'));
    const user = await ready();
    await user.click(uploadButton());
    await screen.findByRole('alert');
    await user.upload(fileInput(), wav());
    await user.click(uploadButton());
    await screen.findByRole('alert');
    await user.selectOptions(screen.getByLabelText('Nguồn dữ liệu *'), '12');
    await user.click(uploadButton());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const keys = [0, 1, 2].map((i) => sentKey(i)['idempotency-key']);
    expect(new Set(keys).size).toBe(3);
  });

  it('shows success, idempotent note, link and focuses heading', async () => {
    fetchMock.mockResolvedValue(ok(true));
    const user = await ready();
    await user.click(uploadButton());
    const heading = await screen.findByRole('heading', {
      name: 'Tải lên thành công',
    });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(
      screen.getByText(
        /Đã tải lên bai1\.wav\. Trạng thái: .+\. Tệp này đã được tải trước đó\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Xem chi tiết' })).toHaveAttribute(
      'href',
      '/admin/media/77',
    );
    await user.click(screen.getByRole('button', { name: 'Tải tệp khác' }));
    expect(
      screen.getByRole('button', { name: 'Chọn tệp' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Nguồn dữ liệu *')).toHaveValue('11');
  });

  it('attaches MEDIA_SOURCE_NOT_APPROVED to the select', async () => {
    fetchMock.mockResolvedValue(fail(422, 'MEDIA_SOURCE_NOT_APPROVED'));
    const user = await ready();
    await user.click(uploadButton());
    const select = screen.getByLabelText('Nguồn dữ liệu *');
    await waitFor(() => expect(select).toHaveAttribute('aria-invalid', 'true'));
    expect(select.getAttribute('aria-describedby')).toContain(
      'media-source-error',
    );
    // V2: focus về ô nguồn sau khi điều khiển mở khoá.
    expect(select).toBeEnabled();
    await waitFor(() => expect(select).toHaveFocus());
  });

  it('keeps the key after 400 INVALID_IDEMPOTENCY_KEY (V4)', async () => {
    fetchMock
      .mockResolvedValueOnce(fail(400, 'INVALID_IDEMPOTENCY_KEY'))
      .mockResolvedValueOnce(ok());
    const user = await ready();
    await user.click(uploadButton());
    await screen.findByRole('alert');
    await user.click(uploadButton());
    await screen.findByText(/Đã tải lên/);
    expect(sentKey(1)['idempotency-key']).toBe(sentKey(0)['idempotency-key']);
  });

  it('uses one live region while pending and no status role on success (V3)', async () => {
    let resolve: (value: Response) => void = () => undefined;
    fetchMock.mockReturnValue(
      new Promise<Response>((next) => {
        resolve = next;
      }),
    );
    const user = await ready();
    await user.click(uploadButton());
    const pending = await screen.findByText('Đang tải lên và kiểm tra tệp…');
    expect(pending.closest('[aria-live]')).not.toBeNull();
    expect(
      document.querySelectorAll('[aria-live], [role="status"]'),
    ).toHaveLength(1);
    resolve(ok());
    await screen.findByRole('heading', { name: 'Tải lên thành công' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows unknown codes in <code> and focuses the error', async () => {
    fetchMock.mockResolvedValue(fail(400, 'WEIRD_CODE'));
    const user = await ready();
    await user.click(uploadButton());
    const alert = await screen.findByRole('alert');
    expect(alert.querySelector('code')?.textContent).toBe('WEIRD_CODE');
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it('ignores a stale response after the file changes', async () => {
    let resolve: (r: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    const user = await ready();
    await user.click(uploadButton());
    expect(screen.getByRole('form')).toHaveAttribute('aria-busy', 'true');
    expect(uploadButton()).toBeDisabled();
    // Phát change trực tiếp (input đang disabled) để tăng requestId.
    fireEvent.change(fileInput(), { target: { files: [wav()] } });
    resolve(ok());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/Đã tải lên/)).toBeNull();
  });
});
