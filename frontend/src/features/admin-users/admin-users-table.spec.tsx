import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { AdminUsersTable } from './admin-users-table';
import type { AdminUserRow } from './admin-users-values';

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

// jsdom chưa cài đặt <dialog> native; polyfill tối thiểu để kiểm logic
// showModal/close + sự kiện close (TL-72) mà không mock component.
beforeAll(() => {
  if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute('open', '');
    };
  }
  if (typeof HTMLDialogElement.prototype.close !== 'function') {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  }
});

const activeUser: AdminUserRow = {
  id: 21,
  email: 'm53-active@example.test',
  name: 'M53 Active Target',
  role: 'user',
  status: 'active',
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const suspendedUser: AdminUserRow = {
  id: 22,
  email: 'm53-suspended@example.test',
  name: 'M53 Suspended Target',
  role: 'user',
  status: 'suspended',
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const pendingUser: AdminUserRow = {
  id: 23,
  email: 'm53-pending@example.test',
  name: 'M53 Pending Target',
  role: 'user',
  status: 'deletion_pending',
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const selfUser: AdminUserRow = {
  id: 99,
  email: 'admin.frontend@example.test',
  name: 'Lin Qiao',
  role: 'admin',
  status: 'active',
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const users = [activeUser, suspendedUser, pendingUser, selfUser];

function desktopTable() {
  return screen.getByRole('table');
}

function renderTable() {
  render(<AdminUsersTable users={users} currentUserId={selfUser.id} />);
}

function deletionButton(row: HTMLElement, label: string) {
  return within(row).getByRole('button', { name: `Xoá tài khoản ${label}` });
}

function rowFor(name: string) {
  return within(desktopTable()).getByRole('row', {
    name: new RegExp(name, 'u'),
  });
}

function dialogElement(): HTMLDialogElement {
  const element = document.querySelector('dialog');
  if (!(element instanceof HTMLDialogElement)) {
    throw new Error('dialog not found');
  }
  return element;
}

const fetchMock = vi.fn();

beforeEach(() => {
  router.refresh.mockReset();
  router.push.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => ({
      success: true,
      data: {
        requestId: 77,
        scheduledAt: '2026-11-09T10:00:00.000Z',
        initiatedBy: 'admin',
      },
    }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AdminUsersTable — under-age deletion action (M1.7d)', () => {
  it('renders an enabled delete action for active, suspended and deletion_pending rows', () => {
    renderTable();

    for (const user of [activeUser, suspendedUser, pendingUser]) {
      const label = user.name ?? user.email;
      expect(deletionButton(rowFor(label), label)).toBeEnabled();
    }
    expect(
      within(desktopTable()).getByRole('button', {
        name: `Xoá tài khoản ${selfUser.name}`,
      }),
    ).toBeDisabled();
  });

  it('disables the delete action on your own row and explains it with aria-describedby', () => {
    renderTable();

    const button = within(desktopTable()).getByRole('button', {
      name: `Xoá tài khoản ${selfUser.name}`,
    });
    expect(button).toBeDisabled();
    const describedBy = button.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? '')?.textContent).toContain(
      'Không thể thao tác trên chính mình.',
    );
  });

  it('opens the dialog focused on the checkbox and keeps confirm disabled until verified', async () => {
    renderTable();
    const opener = deletionButton(
      rowFor(activeUser.name ?? ''),
      activeUser.name ?? '',
    );
    fireEvent.click(opener);

    const dialog = screen.getByRole('dialog', {
      name: 'Xoá tài khoản người dưới 16 tuổi?',
    });
    expect(
      within(dialog).getByText(activeUser.name ?? '', { exact: false }),
    ).toBeTruthy();
    expect(within(dialog).getByText(activeUser.email)).toBeTruthy();
    expect(
      within(dialog).getByText(
        /Tài khoản bị khoá ngay và mọi phiên đăng nhập/u,
      ),
    ).toBeTruthy();

    const checkbox = within(dialog).getByLabelText(
      'Tôi đã xác minh người dùng dưới 16 tuổi.',
    );
    await waitFor(() => expect(checkbox).toHaveFocus());

    const confirm = within(dialog).getByRole('button', {
      name: 'Xoá tài khoản',
    });
    expect(confirm).toBeDisabled();
    fireEvent.click(checkbox);
    expect(confirm).toBeEnabled();
  });

  it('posts under_age, closes the dialog and announces the scheduled date', async () => {
    renderTable();
    const opener = deletionButton(
      rowFor(activeUser.name ?? ''),
      activeUser.name ?? '',
    );
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', {
      name: 'Xoá tài khoản người dưới 16 tuổi?',
    });
    fireEvent.click(
      within(dialog).getByLabelText('Tôi đã xác minh người dùng dưới 16 tuổi.'),
    );
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Xoá tài khoản' }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/users/21/deletion-request',
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'under_age' }),
      },
    );
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Đã lên lịch xoá tài khoản M53 Active Target vào 09/11/2026 17:00.',
      ),
    );
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('asks for escalation copy on a deletion_pending row and confirms', async () => {
    renderTable();
    fireEvent.click(
      deletionButton(rowFor(pendingUser.name ?? ''), pendingUser.name ?? ''),
    );
    const dialog = screen.getByRole('dialog', {
      name: 'Xoá tài khoản người dưới 16 tuổi?',
    });
    expect(
      within(dialog).getByText(
        /Tài khoản đang chờ xoá theo yêu cầu của người dùng\./u,
      ),
    ).toBeTruthy();
    expect(within(dialog).getByText(/ngày xoá giữ nguyên/u)).toBeTruthy();

    fireEvent.click(
      within(dialog).getByLabelText('Tôi đã xác minh người dùng dưới 16 tuổi.'),
    );
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Xoá tài khoản' }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/admin/users/23/deletion-request',
    );
  });

  it('shows the Vietnamese conflict message inside the dialog and live region', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: { code: 'USER_DELETION_ALREADY_DUE' } }),
    });
    renderTable();
    fireEvent.click(
      deletionButton(rowFor(activeUser.name ?? ''), activeUser.name ?? ''),
    );
    const dialog = screen.getByRole('dialog', {
      name: 'Xoá tài khoản người dưới 16 tuổi?',
    });
    fireEvent.click(
      within(dialog).getByLabelText('Tôi đã xác minh người dùng dưới 16 tuổi.'),
    );
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Xoá tài khoản' }),
    );

    await waitFor(() =>
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'Yêu cầu xoá đã đến hạn, không thể thay đổi.',
      ),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Yêu cầu xoá đã đến hạn, không thể thay đổi.',
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('closes on Escape and returns focus to the opener (TL-72)', async () => {
    renderTable();
    const opener = deletionButton(
      rowFor(suspendedUser.name ?? ''),
      suspendedUser.name ?? '',
    );
    fireEvent.click(opener);
    const dialog = dialogElement();
    expect(dialog.open).toBe(true);
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(dialog.open).toBe(false));
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
