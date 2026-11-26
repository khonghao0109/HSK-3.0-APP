'use client';

import { useId, useState } from 'react';

import { useRouter } from 'next/navigation';

import type {
  OptionalConsentState,
  OptionalConsentType,
} from './privacy-values';

/**
 * M1.7b2 B3 (Q190): the optional consents a learner switches on the profile
 * page (PO 24/11). Off by default; the choice is only recorded, nothing is
 * tracked yet (Q200). Switch pattern of web/notifications.html.
 */

const ITEMS: ReadonlyArray<{
  type: OptionalConsentType;
  name: string;
  hint: string;
}> = [
  {
    type: 'analytics',
    name: 'Phân tích sản phẩm',
    // PO 26/11.
    hint: 'Cho phép ghi lại các thao tác trong ứng dụng (ẩn danh hoá) để chúng tôi cải thiện bài học. Tắt bất cứ lúc nào.',
  },
  {
    type: 'marketing',
    name: 'Tin tức và ưu đãi',
    hint: 'Nhận tin về tính năng mới và ưu đãi qua email',
  },
];

const COPY = {
  failed: 'Chưa lưu được lựa chọn. Thử lại sau ít phút.',
  limited: 'Bạn đổi lựa chọn quá nhanh. Thử lại sau một phút.',
  network: 'Không kết nối được. Kiểm tra mạng rồi thử lại.',
  unavailable: 'Chưa tải được lựa chọn của bạn. Tải lại trang để thử lại.',
} as const;

export function OptionalConsentSwitches({
  initial,
}: {
  initial: OptionalConsentState | null;
}) {
  const router = useRouter();
  const id = useId();
  const [state, setState] = useState(initial);
  const [saving, setSaving] = useState<
    Partial<Record<OptionalConsentType, boolean>>
  >({});
  const [errors, setErrors] = useState<
    Partial<Record<OptionalConsentType, string>>
  >({});

  if (!state) {
    return (
      <p className="consent__fine" role="status">
        {COPY.unavailable}
      </p>
    );
  }

  async function toggle(type: OptionalConsentType, granted: boolean) {
    if (saving[type]) return;
    setSaving((current) => ({ ...current, [type]: true }));
    setErrors((current) => ({ ...current, [type]: undefined }));
    setState((current) => current && { ...current, [type]: granted });
    let error: string | null = null;
    try {
      const response = await fetch(`/api/learner/consents/optional/${type}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ granted }),
      });
      if (response.status === 401) {
        // The BFF cleared the session.
        router.replace('/sign-in');
        return;
      }
      if (!response.ok) {
        error = response.status === 429 ? COPY.limited : COPY.failed;
      }
    } catch {
      error = COPY.network;
    }
    if (error) {
      // Back to what the backend still has.
      setState((current) => current && { ...current, [type]: !granted });
      setErrors((current) => ({ ...current, [type]: error }));
    }
    setSaving((current) => ({ ...current, [type]: false }));
  }

  return (
    <ul className="privacy-switches">
      {ITEMS.map(({ type, name, hint }) => {
        const nameId = `${id}-${type}`;
        const hintId = `${id}-${type}-hint`;
        const errorId = `${id}-${type}-error`;
        const checked = state[type];
        return (
          <li key={type}>
            <span className="grow">
              <b id={nameId}>{name}</b>
              <small id={hintId}>{hint}</small>
              {errors[type] && (
                <span className="field__error" id={errorId} role="alert">
                  {errors[type]}
                </span>
              )}
            </span>
            <label className="switch">
              <input
                type="checkbox"
                role="switch"
                checked={checked}
                aria-checked={checked}
                aria-labelledby={nameId}
                aria-describedby={
                  errors[type] ? `${hintId} ${errorId}` : hintId
                }
                aria-busy={saving[type] || undefined}
                onChange={(event) =>
                  void toggle(type, event.currentTarget.checked)
                }
              />
              <span></span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
