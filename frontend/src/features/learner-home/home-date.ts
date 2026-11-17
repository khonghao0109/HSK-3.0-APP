/** Home falls back to Vietnam time; the home payload carries no timezone yet. */
export const HOME_DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';

/** Home sub-line, e.g. "Thứ Ba, 17/11/2026", for `now` in `timeZone`. */
export function homeDateLabel(
  now: Date,
  timeZone: string = HOME_DEFAULT_TIMEZONE,
): string {
  const parts = new Intl.DateTimeFormat('vi-VN', {
    timeZone,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const weekday = part('weekday');
  const capitalised =
    weekday.charAt(0).toLocaleUpperCase('vi-VN') + weekday.slice(1);
  return `${capitalised}, ${part('day')}/${part('month')}/${part('year')}`;
}
