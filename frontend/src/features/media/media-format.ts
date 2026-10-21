/** M5.2a/M5.2b: hàm thuần (không Zod) dùng chung cho màn tải và danh sách tải lên. */
const MIB = 1024 * 1024;

/** Nit M5.2a: ≥ 1 MiB hiện "x,y MB", nhỏ hơn hiện "x,y KB" (vi-VN). */
export function formatMediaBytes(bytes: number): string {
  const [value, unit] =
    bytes >= MIB ? [bytes / MIB, 'MB'] : [bytes / 1024, 'KB'];
  return `${value.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${unit}`;
}
