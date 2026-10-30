import { badgeTone, type AdminBadgeTone } from './admin-labels';

/**
 * Badge trạng thái của mẫu admin (docs/ui_reference/admin/css/admin.css
 * `.status`): chấm màu + nhãn, tông theo `badgeTone` trong admin-labels.ts.
 * Trang admin dùng component này thay vì tự ghép class. Khi tông không suy ra
 * được từ một status enum (ví dụ "Trạng thái duyệt" M5.1a), truyền `tone`
 * trực tiếp — `tone` thắng `status`.
 */
export function AdminBadge({
  status,
  tone,
  label,
}: {
  /** Giá trị enum gốc (published, quarantined, …) để suy ra tông màu. */
  status?: string;
  /** Tông đã quyết sẵn (revisionReviewStateTone, …); thắng `status`. */
  tone?: AdminBadgeTone;
  /** Nhãn tiếng Việt đã qua admin-labels. */
  label: string;
}) {
  const resolved = tone ?? badgeTone(status ?? 'pending');
  return <span className={`adm-badge adm-badge--${resolved}`}>{label}</span>;
}
