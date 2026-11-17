/**
 * Icon nét dùng chung phía người học: vẽ một symbol `#i-<name>` của sprite
 * trong `app/(learner)/layout.tsx`. Màu theo `currentColor`, nét và kích thước
 * lấy từ `.icon` / `.icon--*` trong `learner.css`. Luôn `aria-hidden`: chữ bên
 * cạnh (hoặc `aria-label` của control) mang nghĩa. Admin dùng `AdminIcon`.
 */
const SIZE_CLASS = {
  12: 'icon--xs',
  16: 'icon--sm',
  18: 'icon--md',
  20: null,
  24: 'icon--lg',
  32: 'icon--xl',
} as const;

export type IconSize = keyof typeof SIZE_CLASS;

export function Icon({
  name,
  size = 20,
  className,
}: {
  name: string;
  size?: IconSize;
  className?: string;
}) {
  const classes = ['icon', SIZE_CLASS[size], className]
    .filter(Boolean)
    .join(' ');
  return (
    <svg className={classes} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}
