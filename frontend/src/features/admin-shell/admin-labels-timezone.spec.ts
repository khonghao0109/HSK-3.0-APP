import { describe, expect, it } from 'vitest';

/**
 * S3: khoá đúng option `timeZone` được truyền cho `Intl.DateTimeFormat`.
 * File này KHÔNG import tĩnh `./admin-labels` để module chỉ được nạp sau khi
 * bọc constructor — nhờ vậy xoá `timeZone` khỏi formatter làm test đỏ, kể cả
 * khi TZ của máy chạy cùng offset UTC+7 (Asia/Saigon) với Asia/Ho_Chi_Minh.
 */
describe('adminDateTime formatter options (S3)', () => {
  it('constructs Intl.DateTimeFormat with timeZone Asia/Ho_Chi_Minh', async () => {
    const RealDateTimeFormat = Intl.DateTimeFormat;
    const calls: unknown[][] = [];
    class RecordingDateTimeFormat extends Intl.DateTimeFormat {
      constructor(...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
        super(...args);
        calls.push(args);
      }
    }
    Object.defineProperty(Intl, 'DateTimeFormat', {
      value: RecordingDateTimeFormat,
      configurable: true,
      writable: true,
    });
    try {
      await import('./admin-labels');
    } finally {
      Object.defineProperty(Intl, 'DateTimeFormat', {
        value: RealDateTimeFormat,
        configurable: true,
        writable: true,
      });
    }
    expect(calls).toEqual(
      expect.arrayContaining([
        ['vi-VN', expect.objectContaining({ timeZone: 'Asia/Ho_Chi_Minh' })],
      ]),
    );
  });

  it('formats the Vietnamese calendar day in the pinned time zone', async () => {
    const { ADMIN_DATETIME_FORMAT, adminDateTime } =
      await import('./admin-labels');
    // 15/10 17:30 UTC = 16/10 00:30 giờ VN: nếu trượt về UTC sẽ sai ngày.
    expect(adminDateTime('2026-10-15T17:30:00.000Z')).toBe('16/10/2026 00:30');
    // ICU canonical hoá Asia/Ho_Chi_Minh → Asia/Saigon ở một số runtime.
    expect(['Asia/Ho_Chi_Minh', 'Asia/Saigon']).toContain(
      ADMIN_DATETIME_FORMAT.resolvedOptions().timeZone,
    );
  });
});
