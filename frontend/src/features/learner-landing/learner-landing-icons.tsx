/**
 * Icon của nhóm "landing": mọi hình đều lấy từ sprite chung trong
 * `layout.tsx` (`#i-<name>`). Luôn `aria-hidden` — chức năng chỉ để trang trí,
 * chữ bên cạnh đã mang nghĩa.
 */
export function LandingIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const classes = className ? `icon ${className}` : 'icon';
  return (
    <svg className={classes} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}
