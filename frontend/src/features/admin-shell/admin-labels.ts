/**
 * Nhãn tiếng Việt cho mọi enum và hành động hiện trong admin (M5.0, Q4/Q88).
 *
 * Đây là CHỖ DUY NHẤT đặt nhãn enum: mọi trang admin import từ đây, không tự
 * dịch rải rác. Module thuần (không import gì) để client component dùng được
 * mà không kéo Zod vào bundle (frontend/AGENTS.md, client-bundle-guard).
 *
 * Giá trị lạ (backend thêm enum mới) rơi về chính chuỗi gốc để không vỡ UI.
 */

/* Bài tập: Bản nháp / Đã xuất bản / Đã lưu trữ */
const EXERCISE_STATUS: Record<string, string> = {
  draft: 'Bản nháp',
  published: 'Đã xuất bản',
  archived: 'Đã lưu trữ',
};

/* Duyệt nội dung: Đã duyệt / Cần sửa / Từ chối */
const REVIEW_DECISION: Record<string, string> = {
  approved: 'Đã duyệt',
  changes_requested: 'Cần sửa',
  rejected: 'Từ chối',
};

/* Loại bài tập: Trắc nghiệm / Điền vào chỗ trống / Nghe chọn đáp án /
   Sắp xếp câu / Nói lặp lại */
const EXERCISE_TYPE: Record<string, string> = {
  mcq: 'Trắc nghiệm',
  fill_blank: 'Điền vào chỗ trống',
  listening_choice: 'Nghe chọn đáp án',
  arrange_sentence: 'Sắp xếp câu',
  speaking_repeat: 'Nói lặp lại',
};

/* Loại media: Âm thanh / Hình ảnh / PDF / Video */
const MEDIA_TYPE: Record<string, string> = {
  audio: 'Âm thanh',
  image: 'Hình ảnh',
  pdf: 'PDF',
  video: 'Video',
};

/* Xử lý media: Chờ xử lý / Đang xử lý / Sẵn sàng / Lỗi xử lý / Đã cách ly */
const PROCESSING_STATUS: Record<string, string> = {
  pending: 'Chờ xử lý',
  processing: 'Đang xử lý',
  ready: 'Sẵn sàng',
  failed: 'Lỗi xử lý',
  quarantined: 'Đã cách ly',
};

/* Vòng đời media: Đang dùng / Đã lưu trữ */
const LIFECYCLE: Record<string, string> = {
  active: 'Đang dùng',
  archived: 'Đã lưu trữ',
};

export function exerciseStatusLabel(status: string): string {
  return EXERCISE_STATUS[status] ?? status;
}

export function reviewDecisionLabel(decision: string): string {
  return REVIEW_DECISION[decision] ?? decision;
}

export function exerciseTypeLabel(type: string): string {
  return EXERCISE_TYPE[type] ?? type;
}

export function mediaTypeLabel(type: string): string {
  return MEDIA_TYPE[type] ?? type;
}

export function processingStatusLabel(status: string): string {
  return PROCESSING_STATUS[status] ?? status;
}

export function lifecycleLabel(lifecycle: string): string {
  return LIFECYCLE[lifecycle] ?? lifecycle;
}

/**
 * Tông badge theo mẫu admin (docs/ui_reference/admin/css/admin.css
 * `.status--*`): ok = jade, draft = amber, info = blue, danger = red,
 * muted = slate. Enum lạ rơi về muted.
 */
export type AdminBadgeTone = 'ok' | 'draft' | 'muted' | 'danger' | 'info';

const BADGE_TONE: Record<string, AdminBadgeTone> = {
  published: 'ok',
  approved: 'ok',
  ready: 'ok',
  active: 'ok',
  draft: 'draft',
  pending: 'draft',
  changes_requested: 'draft',
  processing: 'info',
  failed: 'danger',
  quarantined: 'danger',
  rejected: 'danger',
  archived: 'muted',
};

export function badgeTone(status: string): AdminBadgeTone {
  return BADGE_TONE[status] ?? 'muted';
}

/* Hành động và vai trò dùng chung (Cách ly · Lưu trữ · Huỷ · Thử lại ·
   Trước · Sau · Đăng nhập · Đăng xuất · Sắp có · Quản trị viên). */
export const ADMIN_ACTION = {
  quarantine: 'Cách ly',
  archive: 'Lưu trữ',
  cancel: 'Huỷ',
  retry: 'Thử lại',
  previous: 'Trước',
  next: 'Sau',
  signIn: 'Đăng nhập',
  signOut: 'Đăng xuất',
  comingSoon: 'Sắp có',
  adminRole: 'Quản trị viên',
} as const;

/**
 * Ngày giờ admin (TL-10): `dd/mm/yyyy hh:mm`, giờ 24h, theo UTC — đúng múi giờ
 * code admin đang dùng trước M5.0 (`timeZone: 'UTC'`). Giá trị thiếu hoặc
 * không hợp lệ trả '—'. Mọi chỗ admin hiện ngày dùng hàm này.
 */
export function adminDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (part: number) => String(part).padStart(2, '0');
  const day = `${pad(date.getUTCDate())}/${pad(
    date.getUTCMonth() + 1,
  )}/${date.getUTCFullYear()}`;
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  return `${day} ${time}`;
}
