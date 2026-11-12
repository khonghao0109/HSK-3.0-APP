import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReviewSettings } from './review-settings';
import type { ReviewCall } from './review-transport';

const prefs = {
  dailyCardLimit: 20,
  levelCodes: [] as string[],
  levels: [
    { code: 'HSK1', name: 'HSK 1' },
    { code: 'HSK3', name: 'HSK 3' },
  ],
};

const ok = <T,>(data: T): ReviewCall<T> => ({ ok: true, data });

function transport() {
  return {
    preferences: vi.fn().mockResolvedValue(ok(prefs)),
    savePreferences: vi.fn(),
  };
}

function open(t: ReturnType<typeof transport>) {
  const onClose = vi.fn();
  render(<ReviewSettings open transport={t as never} onClose={onClose} />);
  return onClose;
}

beforeEach(() => {
  if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    });
  }
  if (typeof HTMLDialogElement.prototype.close !== 'function') {
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    });
  }
});

describe('ReviewSettings (M3.3c, Q279)', () => {
  it('shows the saved limit, the three choices and the real levels', async () => {
    const t = transport();
    open(t);
    const select = await screen.findByLabelText('Số thẻ mỗi ngày');
    expect(select).toHaveValue('20');
    expect(
      Array.from((select as HTMLSelectElement).options).map((o) => o.text),
    ).toEqual(['10 thẻ', '20 thẻ', '30 thẻ']);
    expect(screen.getByRole('group', { name: 'Lọc cấp' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Tất cả cấp' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Chỉ HSK 1' })).not.toBeChecked();
    expect(
      screen.getByRole('radio', { name: 'Chỉ HSK 3' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Tự phát âm sẽ bật khi API audio từ vựng sẵn sàng (Q66).',
      ),
    ).toBeInTheDocument();
  });

  it('checks the saved level', async () => {
    const t = transport();
    t.preferences.mockResolvedValue(ok({ ...prefs, levelCodes: ['HSK3'] }));
    open(t);
    expect(
      await screen.findByRole('radio', { name: 'Chỉ HSK 3' }),
    ).toBeChecked();
  });

  it('saves the chosen values and says Đã lưu', async () => {
    const t = transport();
    t.savePreferences.mockResolvedValue(
      ok({ ...prefs, dailyCardLimit: 10, levelCodes: ['HSK3'] }),
    );
    const onClose = open(t);
    fireEvent.change(await screen.findByLabelText('Số thẻ mỗi ngày'), {
      target: { value: '10' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Chỉ HSK 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cài đặt' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Đã lưu cài đặt ôn tập.',
    );
    expect(t.savePreferences).toHaveBeenCalledWith({
      dailyCardLimit: 10,
      levelCodes: ['HSK3'],
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows an error when saving fails and keeps the choices', async () => {
    const t = transport();
    t.savePreferences.mockResolvedValue({ ok: false, status: 503, code: null });
    open(t);
    fireEvent.change(await screen.findByLabelText('Số thẻ mỗi ngày'), {
      target: { value: '30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu cài đặt' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Chưa lưu được cài đặt. Thử lại sau.',
    );
    expect(screen.getByLabelText('Số thẻ mỗi ngày')).toHaveValue('30');
  });

  it('shows an error when the settings cannot be read', async () => {
    const t = transport();
    t.preferences.mockResolvedValue({ ok: false, status: 0, code: null });
    open(t);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Chưa tải được cài đặt.',
    );
    expect(screen.getByRole('button', { name: 'Lưu cài đặt' })).toBeDisabled();
  });

  it('closes with Huỷ without saving', async () => {
    const t = transport();
    const onClose = open(t);
    await screen.findByLabelText('Số thẻ mỗi ngày');
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(t.savePreferences).not.toHaveBeenCalled();
  });
});
