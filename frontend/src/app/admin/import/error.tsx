'use client';

import { AdminIcon } from '@/features/admin-shell/admin-icon';

export default function ImportError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="adm-card adm-state-card" role="alert">
      <span
        className="adm-state-card__mark adm-state-card__mark--danger"
        aria-hidden="true"
      >
        <AdminIcon name="alert-triangle" />
      </span>
      <h1>Không tải được trang nhập dữ liệu</h1>
      <p>
        Máy chủ trả về dữ liệu không hợp lệ hoặc tạm thời không khả dụng. Không
        có chi tiết hệ thống nào bị lộ.
      </p>
      <div className="adm-state-card__actions">
        <button
          className="adm-btn adm-btn--primary"
          type="button"
          onClick={reset}
        >
          Thử lại
        </button>
      </div>
    </div>
  );
}
