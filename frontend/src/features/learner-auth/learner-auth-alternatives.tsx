'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * `switchLink` is a slot for the page's `.wa-switch` line: the web sample has
 * "Chưa có tài khoản? Tạo tài khoản" (and the sign-up mirror), the mobile
 * screen deliberately has no such link, so the page owns it and passes it in
 * (M2.10c). Rendering without the slot keeps the mobile content unchanged.
 */
export function LearnerAuthAlternatives({
  switchLink,
}: {
  switchLink?: ReactNode;
} = {}) {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const triggerToast = (message: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 2400);
  };

  return (
    <>
      <p className="divider-text auth__divider">hoặc</p>
      <div className="auth__social">
        <button
          className="social-btn"
          type="button"
          onClick={() => triggerToast('Tính năng sắp ra mắt.')}
        >
          <svg aria-hidden="true">
            <use href="#logo-google" />
          </svg>
          Tiếp tục với Google
        </button>
        <button
          className="social-btn"
          type="button"
          onClick={() => triggerToast('Tính năng sắp ra mắt.')}
        >
          <svg aria-hidden="true">
            <use href="#logo-apple" />
          </svg>
          Tiếp tục với Apple
        </button>
        <button
          className="social-btn"
          type="button"
          onClick={() => triggerToast('Tính năng sắp ra mắt.')}
        >
          <svg aria-hidden="true">
            <use href="#logo-facebook" />
          </svg>
          Tiếp tục với Facebook
        </button>
      </div>

      {switchLink}

      <p className="auth__terms">
        {/* `{' '}` giữ đúng khoảng cách của mẫu khi bản web ẩn `<br>`; trên
            mobile khoảng trắng cuối dòng bị CSS bỏ nên không xê dịch pixel. */}
        Bằng việc tiếp tục, bạn đồng ý với <br />
        <Link href="/terms">Điều khoản sử dụng</Link> và{' '}
        <Link href="/privacy">Chính sách bảo mật</Link>
      </p>

      <div className="toast-region" role="status" aria-live="polite">
        {toastMessage && <div className="toast">{toastMessage}</div>}
      </div>
    </>
  );
}
