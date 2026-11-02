import { describe, expect, it } from 'vitest';

import {
  EXAM_RESULT_CANCELLED,
  EXAM_RESULT_NO_WEAK_AREAS,
  EXAM_RESULT_NO_XP,
  EXAM_RESULT_RETRY_TEXT,
  formatExamDate,
  formatExamDuration,
  passBadgeLabel,
  passHeadline,
  progressPercent,
  skillIcon,
  skillLabel,
  weakAreaLevelLabel,
} from './exam-result-model';

describe('exam result model (M4.3, TL-172)', () => {
  it('formats the working time as mm:ss and h:mm:ss from one hour (Q168)', () => {
    expect(
      formatExamDuration(
        '2026-05-19T09:00:00.000Z',
        '2026-05-19T09:31:42.000Z',
      ),
    ).toBe('31:42');
    expect(
      formatExamDuration(
        '2026-05-19T09:00:00.000Z',
        '2026-05-19T09:59:59.000Z',
      ),
    ).toBe('59:59');
    expect(
      formatExamDuration(
        '2026-05-19T09:00:00.000Z',
        '2026-05-19T10:02:03.000Z',
      ),
    ).toBe('1:02:03');
    expect(
      formatExamDuration(
        '2026-05-19T09:00:00.000Z',
        '2026-05-19T09:00:00.000Z',
      ),
    ).toBe('00:00');
  });

  it('formats the submission date in the exam time zone (Q168)', () => {
    expect(formatExamDate('2025-05-19T02:00:00.000Z')).toBe('19/05/2025');
  });

  it('maps the three pass states to the Q165 copy', () => {
    expect(passBadgeLabel(true)).toBe('Đạt');
    expect(passBadgeLabel(false)).toBe('Chưa đạt');
    expect(passBadgeLabel(null)).toBeNull();
    expect(passHeadline(true)).toBe('Bạn đã đạt!');
    expect(passHeadline(false)).toBe('Bạn chưa đạt');
    expect(passHeadline(null)).toBe('Đề này chưa đặt điểm đạt');
  });

  it('maps weak levels and skills to their labels and icons (Q154)', () => {
    expect(weakAreaLevelLabel('weak')).toBe('Yếu');
    expect(weakAreaLevelLabel('medium')).toBe('Trung bình');
    expect(skillLabel('listening')).toBe('Nghe');
    expect(skillLabel('reading')).toBe('Đọc');
    expect(skillIcon('speaking')).toBe('mic');
  });

  it('clamps the progress value to 0..100', () => {
    expect(progressPercent(86, 100)).toBe(86);
    expect(progressPercent(150, 100)).toBe(100);
    expect(progressPercent(-1, 100)).toBe(0);
    expect(progressPercent(1, 0)).toBe(0);
  });

  it('exports the fixed Q14/Q166/Q167 copy', () => {
    expect(EXAM_RESULT_NO_XP).toBe(
      'Kết quả thi thử không cộng XP hay huy hiệu.',
    );
    expect(EXAM_RESULT_NO_WEAK_AREAS).toBe(
      'Chưa đủ dữ liệu để xác định điểm yếu.',
    );
    expect(EXAM_RESULT_CANCELLED).toBe('Bài thi đã bị huỷ, không có kết quả.');
  });
});
