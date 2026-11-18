import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AdminMediaIngestion } from './media-contract';
import { MediaIngestionList } from './media-ingestion-list';

const { refresh, push } = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
  push.mockReset();
});

function ingestion(
  over: Partial<AdminMediaIngestion> = {},
): AdminMediaIngestion {
  return {
    id: 41,
    status: 'cleanup_required',
    failureCode: 'OBJECT_WRITE_OUTCOME_UNKNOWN',
    filename: 'tone.wav',
    size: 2048,
    dataSource: {
      id: 3,
      code: 'FRONTEND_CONSOLE_V1',
      name: 'Console',
      version: 'v1',
    },
    startedAt: '2026-10-21T01:00:00.000Z',
    processingStartedAt: null,
    cleanupRequiredAt: '2026-10-21T01:00:01.000Z',
    cleanupAttempts: 0,
    cleanupLastAttemptAt: null,
    cleanupAvailable: true,
    ...over,
  };
}

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function card(name: string) {
  const item = screen.getByText(name).closest('li');
  if (!item) throw new Error(`no card ${name}`);
  return within(item);
}

describe('MediaIngestionList (TL-51/TL-52)', () => {
  it('shows labels, source and a cleanup button only where cleanup is available', () => {
    render(
      <MediaIngestionList
        total={3}
        ingestions={[
          ingestion(),
          ingestion({
            id: 42,
            status: 'processing',
            filename: null,
            failureCode: null,
            cleanupAvailable: false,
            cleanupRequiredAt: null,
            processingStartedAt: '2026-10-21T01:00:00.000Z',
          }),
          ingestion({
            id: 43,
            filename: 'old.png',
            cleanupAvailable: false,
            failureCode: 'SOMETHING_NEW',
          }),
        ]}
      />,
    );
    const first = card('tone.wav');
    expect(first.getByText('Cần dọn dẹp')).toHaveClass('adm-badge--draft');
    expect(first.getByText('Không rõ kết quả ghi tệp')).toBeInTheDocument();
    expect(first.getByText('FRONTEND_CONSOLE_V1 · v1')).toBeInTheDocument();
    expect(first.getByText('2,0 KB')).toBeInTheDocument();
    expect(first.getByRole('button', { name: 'Dọn dẹp' })).toBeInTheDocument();

    const stuck = card('Tệp #42');
    expect(stuck.getByText('Kẹt xử lý')).toHaveClass('adm-badge--danger');
    expect(stuck.getByText('Bắt đầu xử lý')).toBeInTheDocument();
    expect(stuck.queryByRole('button')).toBeNull();
    expect(
      stuck.getByText('Liên hệ vận hành để đối soát thủ công.'),
    ).toBeInTheDocument();

    const other = card('old.png');
    expect(other.getByText('SOMETHING_NEW')).toHaveClass('adm-mono');
    expect(other.queryByRole('button')).toBeNull();
  });

  it('says the list is empty, or that an overflow page has no rows', () => {
    const { rerender } = render(
      <MediaIngestionList total={0} ingestions={[]} />,
    );
    expect(
      screen.getByText('Không có bản ghi tải lên cần xử lý.'),
    ).toBeInTheDocument();
    rerender(<MediaIngestionList total={5} ingestions={[]} />);
    expect(
      screen.getByText(/Trang này không có bản ghi\./u),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Về trang 1' })).toHaveAttribute(
      'href',
      '/admin/media/ingestions?page=1',
    );
  });

  it.each([
    [
      201,
      { success: true, data: { ingestionId: 41, cleanupCompleted: true } },
      'Đã dọn dẹp bản ghi #41.',
      true,
    ],
    [
      201,
      {
        success: true,
        data: { ingestionId: 41, cleanupCompleted: false, settling: true },
      },
      'Bản ghi #41: tệp không còn trong storage. Bấm Dọn dẹp lại sau ít nhất 1 phút để hoàn tất.',
      true,
    ],
    [
      409,
      { success: false, error: { code: 'CONFLICT' } },
      'Bản ghi #41 đã thay đổi hoặc đang được dọn. Danh sách đã được làm mới.',
      true,
    ],
    [
      503,
      { success: false, error: { code: 'MEDIA_CLEANUP_REQUIRED' } },
      'Storage tạm thời không dọn được. Thử lại sau.',
      true,
    ],
    [
      503,
      { success: false, error: { code: 'MEDIA_CLEANUP_OUTCOME_UNKNOWN' } },
      'Chưa rõ kết quả dọn dẹp. Làm mới trang để xem trạng thái.',
      false,
    ],
    [
      500,
      { success: false, error: {} },
      'Không dọn dẹp được. Thử lại sau.',
      false,
    ],
  ])(
    'status %i announces the outcome and refreshes when the list may change',
    async (status, body, message, refreshes) => {
      const fetchMock = stubFetch(status, body);
      render(<MediaIngestionList total={1} ingestions={[ingestion()]} />);
      await userEvent.click(screen.getByRole('button', { name: 'Dọn dẹp' }));
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/media/ingestions/41/cleanup',
        {
          method: 'POST',
          credentials: 'same-origin',
        },
      );
      expect(refresh).toHaveBeenCalledTimes(refreshes ? 1 : 0);
      expect(screen.getByText(message)).toHaveAttribute('aria-live', 'polite');
    },
  );

  it('disables the button with "Đang dọn dẹp…" while the request runs', async () => {
    let resolve: (value: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((next) => (resolve = next))),
    );
    render(<MediaIngestionList total={1} ingestions={[ingestion()]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Dọn dẹp' }));
    expect(
      screen.getByRole('button', { name: 'Đang dọn dẹp…' }),
    ).toBeDisabled();
    resolve(
      new Response(
        JSON.stringify({
          success: true,
          data: { ingestionId: 41, cleanupCompleted: true },
        }),
        { status: 201 },
      ),
    );
    expect(
      await screen.findByText('Đã dọn dẹp bản ghi #41.'),
    ).toBeInTheDocument();
  });

  it('returns focus to the card button, or the list heading once the card is gone', async () => {
    stubFetch(409, { success: false, error: { code: 'CONFLICT' } });
    const { rerender } = render(
      <MediaIngestionList total={1} ingestions={[ingestion()]} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Dọn dẹp' }));
    await screen.findByText(/đã thay đổi hoặc đang được dọn/u);
    screen.getByRole('button', { name: 'Dọn dẹp' }).blur();
    expect(document.body).toHaveFocus();
    rerender(<MediaIngestionList total={1} ingestions={[ingestion()]} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Dọn dẹp' })).toHaveFocus(),
    );

    stubFetch(201, {
      success: true,
      data: { ingestionId: 41, cleanupCompleted: true },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Dọn dẹp' }));
    await screen.findByText('Đã dọn dẹp bản ghi #41.');
    screen.getByRole('button', { name: 'Dọn dẹp' }).blur();
    rerender(<MediaIngestionList total={0} ingestions={[]} />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Danh sách tải lên' }),
      ).toHaveFocus(),
    );
  });

  it('sends a 401 to the login page', async () => {
    stubFetch(401, { success: false });
    render(<MediaIngestionList total={1} ingestions={[ingestion()]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Dọn dẹp' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
  });
});
