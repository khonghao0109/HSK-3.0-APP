'use client';

export default function LearnerError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="app auth">
      <h1 className="auth__title">Đã có lỗi xảy ra</h1>
      <p className="auth__subtitle">
        Không thể kết nối hoặc máy chủ đang gặp sự cố. Vui lòng thử lại sau.
      </p>

      <button
        type="button"
        onClick={() => reset()}
        className="btn btn--primary btn--block auth__submit"
      >
        Thử lại
      </button>
    </div>
  );
}
