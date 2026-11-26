import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DataExportItem } from './privacy-values';
import { PrivacyRightsPanel } from './privacy-rights-panel';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const READY: DataExportItem = {
  id: 4,
  status: 'completed',
  createdAt: '2026-11-25T01:00:00.000Z',
  completedAt: '2026-11-25T01:05:00.000Z',
  outputExpiresAt: '2026-11-26T01:05:00.000Z',
  downloadable: true,
};
const WAITING: DataExportItem = {
  id: 5,
  status: 'requested',
  createdAt: '2026-11-26T01:00:00.000Z',
  completedAt: null,
  outputExpiresAt: null,
  downloadable: false,
};

function list(items: DataExportItem[]) {
  return Response.json({ success: true, data: items });
}

function failure(status: number, code?: string) {
  return Response.json(
    { success: false, error: { kind: 'x', message: 'x', code } },
    { status },
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  for (const name of ['showModal', 'close'] as const) {
    Object.defineProperty(HTMLDialogElement.prototype, name, {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = name === 'showModal';
      },
    });
  }
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  router.replace.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderPanel(items: DataExportItem[] = []) {
  fetchMock.mockResolvedValueOnce(list(items));
  render(<PrivacyRightsPanel />);
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith('/api/learner/data-exports', {
      cache: 'no-store',
    }),
  );
}

describe('PrivacyRightsPanel (M1.7b2 B2b, Q189)', () => {
  it('offers export, deletion and sign-out under "Quyền của bạn"', async () => {
    await renderPanel();
    const region = screen.getByRole('region', { name: 'Quyền của bạn' });
    for (const name of [/Xuất dữ liệu/, /Xoá tài khoản/, 'Đăng xuất']) {
      expect(within(region).getByRole('button', { name })).toBeVisible();
    }
  });

  it('lists the exports and links only a ready one to its download', async () => {
    await renderPanel([WAITING, READY]);
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Đang chuẩn bị');
    expect(within(items[0]!).queryByRole('link')).toBeNull();
    expect(items[1]).toHaveTextContent('Sẵn sàng');
    expect(
      within(items[1]!).getByRole('link', { name: 'Tải về' }),
    ).toHaveAttribute('href', '/api/learner/data-exports/4/download');
  });

  it('labels an expired and a failed export without a link', async () => {
    await renderPanel([
      { ...READY, id: 6, downloadable: false },
      { ...WAITING, id: 7, status: 'failed' },
    ]);
    const items = await screen.findAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Đã hết hạn');
    expect(items[1]).toHaveTextContent('Không tạo được');
    expect(screen.queryByRole('link', { name: 'Tải về' })).toBeNull();
  });

  it('requests an export from its dialog, then shows it waiting', async () => {
    await renderPanel();
    const opener = screen.getByRole('button', { name: /Xuất dữ liệu/ });
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Yêu cầu xuất dữ liệu' });
    fetchMock
      .mockResolvedValueOnce(
        Response.json(
          { success: true, data: { exportId: 5, status: 'requested' } },
          { status: 202 },
        ),
      )
      .mockResolvedValueOnce(list([WAITING]));
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Gửi yêu cầu' }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/learner/data-exports', {
        method: 'POST',
      }),
    );
    expect(await screen.findByRole('listitem')).toHaveTextContent(
      'Đang chuẩn bị',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Đã gửi yêu cầu');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('explains the one-export-per-24-hours limit', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Xuất dữ liệu/ }));
    fetchMock.mockResolvedValueOnce(failure(429, 'EXPORT_RATE_LIMITED'));
    fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Bạn đã yêu cầu xuất dữ liệu trong 24 giờ qua.',
    );
  });

  it('closes a dialog with Esc and gives focus back to its button', async () => {
    await renderPanel();
    const opener = screen.getByRole('button', { name: /Xoá tài khoản/ });
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Xoá tài khoản?' });
    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('asks for the password and ties the error to the field', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Xoá tài khoản/ }));
    const dialog = screen.getByRole('dialog', { name: 'Xoá tài khoản?' });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Xoá tài khoản' }),
    );
    const password = within(dialog).getByLabelText(
      'Nhập mật khẩu hiện tại để xác nhận',
    );
    const error = within(dialog).getByRole('alert');
    expect(error).toHaveTextContent('Nhập mật khẩu hiện tại để xác nhận.');
    expect(password).toHaveAttribute('aria-describedby', error.id);
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.change(password, { target: { value: 'wrong-password' } });
    fetchMock.mockResolvedValueOnce(failure(400, 'INVALID_PASSWORD'));
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Xoá tài khoản' }),
    );
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Mật khẩu không đúng.',
    );
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('schedules the deletion with the password, then leaves for sign-in', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Xoá tài khoản/ }));
    const dialog = screen.getByRole('dialog', { name: 'Xoá tài khoản?' });
    fireEvent.change(
      within(dialog).getByLabelText('Nhập mật khẩu hiện tại để xác nhận'),
      { target: { value: 'StrongPassword123!' } },
    );
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { success: true, data: { scheduledAt: '2026-12-03T01:00:00.000Z' } },
        { status: 202 },
      ),
    );
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Xoá tài khoản' }),
    );
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/sign-in'),
    );
    const [url, init] = fetchMock.mock.calls[1] ?? [];
    expect(url).toBe('/api/learner/account-deletion');
    expect(init).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(init?.body))).toEqual({
      password: 'StrongPassword123!',
    });
  });
});
