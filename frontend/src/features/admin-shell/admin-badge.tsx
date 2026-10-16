import { badgeTone } from './admin-labels';

/**
 * Badge trạng thái của mẫu admin (docs/ui_reference/admin/css/admin.css
 * `.status`): chấm màu + nhãn, tông theo `badgeTone` trong admin-labels.ts.
 * Trang admin dùng component này thay vì tự ghép class.
 */
export function AdminBadge({
  status,
  label,
}: {
  /** Giá trị enum gốc (published, quarantined, …) để suy ra tông màu. */
  status: string;
  /** Nhãn tiếng Việt đã qua admin-labels. */
  label: string;
}) {
  return (
    <span className={`adm-badge adm-badge--${badgeTone(status)}`}>{label}</span>
  );
}
