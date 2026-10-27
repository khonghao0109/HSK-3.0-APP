/**
 * Icon admin tham chiếu sprite (M5.0): `<use href="#i-…">` tới các symbol do
 * `AdminIconSprite` (admin-icon-sprite.tsx) khai báo một lần trong shell.
 * Hình nét chép nguyên từ `docs/ui_reference/shared/js/icons.js` và
 * `icons-m06.js` — không tự vẽ lại.
 */
export const ADMIN_ICON_NAMES = [
  'leaf',
  'layout-dashboard',
  'file-stack',
  'clipboard-check',
  'clipboard-list',
  'image',
  'file-question',
  'upload',
  'users',
  'bar-chart',
  'cpu',
  'message-circle',
  'settings',
  'menu',
  'user',
  'log-out',
  'plus',
  'search',
  'x',
  'filter',
  'chevron-left',
  'chevron-right',
  'eye',
  'pencil',
  'alert-triangle',
  'rotate-ccw',
  'archive',
] as const;

export type AdminIconName = (typeof ADMIN_ICON_NAMES)[number];

export function AdminIcon({
  name,
  className = 'adm-icon',
}: {
  name: AdminIconName;
  className?: string;
}) {
  return (
    <svg className={className} aria-hidden="true" focusable="false">
      <use href={`#i-${name}`} />
    </svg>
  );
}
