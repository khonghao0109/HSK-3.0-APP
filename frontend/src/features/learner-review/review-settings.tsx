'use client';

import { useEffect, useId, useRef, useState } from 'react';

import type { ReviewTransport } from './review-transport';

/** M3.3c (Q279): the three choices of "Số thẻ mỗi ngày", as the API accepts them. */
const DAILY_LIMITS = [10, 20, 30] as const;
const ALL_LEVELS = '';

export type ReviewPreferences = {
  dailyCardLimit: number;
  levelCodes: string[];
  levels: { code: string; name: string }[];
};

type Status =
  | { kind: 'loading' }
  | { kind: 'load-error' }
  | { kind: 'ready' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'save-error' };

/**
 * M3.3c (Q279): "Cài đặt ôn tập" from web/flashcards.html. The values come
 * from and go to the server (`/review/preferences` through the BFF); a level
 * radio saves one code, "Tất cả cấp" saves none. Mounted per opening, so
 * every opening reads the saved values again.
 */
export function ReviewSettings({
  open,
  transport,
  onClose,
}: {
  open: boolean;
  transport: Pick<ReviewTransport, 'preferences' | 'savePreferences'>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const ids = useId();
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [levels, setLevels] = useState<ReviewPreferences['levels']>([]);
  const [limit, setLimit] = useState(20);
  const [level, setLevel] = useState(ALL_LEVELS);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void transport.preferences<ReviewPreferences>().then((result) => {
      if (!live) return;
      if (!result.ok) return setStatus({ kind: 'load-error' });
      setLevels(result.data.levels);
      setLimit(result.data.dailyCardLimit);
      setLevel(
        result.data.levelCodes.length === 1
          ? (result.data.levelCodes[0] ?? ALL_LEVELS)
          : ALL_LEVELS,
      );
      setStatus({ kind: 'ready' });
    });
    return () => {
      live = false;
    };
  }, [open, transport]);

  async function save() {
    setStatus({ kind: 'saving' });
    const result = await transport.savePreferences({
      dailyCardLimit: limit,
      levelCodes: level === ALL_LEVELS ? [] : [level],
    });
    setStatus({ kind: result.ok ? 'saved' : 'save-error' });
  }

  const loaded = status.kind !== 'loading' && status.kind !== 'load-error';
  const titleId = `${ids}-title`;
  const descId = `${ids}-desc`;

  return (
    <dialog
      ref={ref}
      className="rv-settings"
      aria-labelledby={titleId}
      aria-describedby={descId}
      onClose={onClose}
    >
      <form
        className="rv-settings__form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h2 id={titleId}>Cài đặt ôn tập</h2>
        <p className="muted" id={descId}>
          Áp dụng cho các phiên ôn tiếp theo. Thay đổi được lưu vào tài khoản.
        </p>
        {status.kind === 'load-error' && (
          <p className="rv-settings__error" role="alert">
            Chưa tải được cài đặt.
          </p>
        )}
        <div className="field">
          <label className="field__label" htmlFor={`${ids}-num`}>
            Số thẻ mỗi ngày
          </label>
          <select
            className="input"
            id={`${ids}-num`}
            value={String(limit)}
            disabled={!loaded}
            onChange={(event) => setLimit(Number(event.target.value))}
          >
            {DAILY_LIMITS.map((value) => (
              <option key={value} value={String(value)}>
                {`${String(value)} thẻ`}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="uxb-fieldset" disabled={!loaded}>
          <legend className="field__label">Lọc cấp</legend>
          <label className="uxb-check">
            <input
              type="radio"
              name={`${ids}-lv`}
              checked={level === ALL_LEVELS}
              onChange={() => setLevel(ALL_LEVELS)}
            />{' '}
            Tất cả cấp
          </label>
          {levels.map((option) => (
            <label className="uxb-check" key={option.code}>
              <input
                type="radio"
                name={`${ids}-lv`}
                checked={level === option.code}
                onChange={() => setLevel(option.code)}
              />{' '}
              {`Chỉ ${option.name}`}
            </label>
          ))}
        </fieldset>
        <p className="uxb-fine">
          Tự phát âm sẽ bật khi API audio từ vựng sẵn sàng (Q66).
        </p>
        {status.kind === 'saved' && (
          <p className="rv-settings__ok" role="status">
            Đã lưu cài đặt ôn tập.
          </p>
        )}
        {status.kind === 'save-error' && (
          <p className="rv-settings__error" role="alert">
            Chưa lưu được cài đặt. Thử lại sau.
          </p>
        )}
        <div className="modal__actions">
          <button className="btn btn--outline" type="button" onClick={onClose}>
            Huỷ
          </button>
          <button
            className="btn btn--primary"
            type="submit"
            disabled={!loaded || status.kind === 'saving'}
          >
            Lưu cài đặt
          </button>
        </div>
      </form>
    </dialog>
  );
}
