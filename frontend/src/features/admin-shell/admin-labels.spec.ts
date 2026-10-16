import { describe, expect, it } from 'vitest';

import {
  ADMIN_ACTION,
  adminDateTime,
  badgeTone,
  exerciseStatusLabel,
  exerciseTypeLabel,
  lifecycleLabel,
  mediaTypeLabel,
  processingStatusLabel,
  reviewDecisionLabel,
} from './admin-labels';

// Chốt bảng thuật ngữ M5.0: đổi nhãn ở đây là đổi cả admin, nên mỗi ánh xạ
// có test khóa đúng chữ tiếng Việt (kể cả dấu "Huỷ", không phải "Hủy").
describe('admin-labels', () => {
  it('maps exercise statuses to Vietnamese', () => {
    expect(exerciseStatusLabel('draft')).toBe('Bản nháp');
    expect(exerciseStatusLabel('published')).toBe('Đã xuất bản');
    expect(exerciseStatusLabel('archived')).toBe('Đã lưu trữ');
  });

  it('maps review decisions to Vietnamese', () => {
    expect(reviewDecisionLabel('approved')).toBe('Đã duyệt');
    expect(reviewDecisionLabel('changes_requested')).toBe('Cần sửa');
    expect(reviewDecisionLabel('rejected')).toBe('Từ chối');
  });

  it('maps exercise types to Vietnamese', () => {
    expect(exerciseTypeLabel('mcq')).toBe('Trắc nghiệm');
    expect(exerciseTypeLabel('fill_blank')).toBe('Điền vào chỗ trống');
    expect(exerciseTypeLabel('listening_choice')).toBe('Nghe chọn đáp án');
    expect(exerciseTypeLabel('arrange_sentence')).toBe('Sắp xếp câu');
    expect(exerciseTypeLabel('speaking_repeat')).toBe('Nói lặp lại');
  });

  it('maps media types to Vietnamese', () => {
    expect(mediaTypeLabel('audio')).toBe('Âm thanh');
    expect(mediaTypeLabel('image')).toBe('Hình ảnh');
    expect(mediaTypeLabel('pdf')).toBe('PDF');
    expect(mediaTypeLabel('video')).toBe('Video');
  });

  it('maps processing statuses to Vietnamese', () => {
    expect(processingStatusLabel('pending')).toBe('Chờ xử lý');
    expect(processingStatusLabel('processing')).toBe('Đang xử lý');
    expect(processingStatusLabel('ready')).toBe('Sẵn sàng');
    expect(processingStatusLabel('failed')).toBe('Lỗi xử lý');
    expect(processingStatusLabel('quarantined')).toBe('Đã cách ly');
  });

  it('maps media lifecycle to Vietnamese', () => {
    expect(lifecycleLabel('active')).toBe('Đang dùng');
    expect(lifecycleLabel('archived')).toBe('Đã lưu trữ');
  });

  it('falls back to the raw value for unknown enum members', () => {
    expect(exerciseStatusLabel('future_status')).toBe('future_status');
    expect(reviewDecisionLabel('future_decision')).toBe('future_decision');
    expect(exerciseTypeLabel('future_type')).toBe('future_type');
    expect(mediaTypeLabel('future_media')).toBe('future_media');
    expect(processingStatusLabel('future_processing')).toBe(
      'future_processing',
    );
    expect(lifecycleLabel('future_lifecycle')).toBe('future_lifecycle');
    expect(badgeTone('future_status')).toBe('muted');
  });

  it('assigns badge tones by enum semantics', () => {
    for (const ok of ['published', 'approved', 'ready', 'active']) {
      expect(badgeTone(ok)).toBe('ok');
    }
    for (const draft of ['draft', 'pending', 'changes_requested']) {
      expect(badgeTone(draft)).toBe('draft');
    }
    expect(badgeTone('processing')).toBe('info');
    for (const danger of ['failed', 'quarantined', 'rejected']) {
      expect(badgeTone(danger)).toBe('danger');
    }
    expect(badgeTone('archived')).toBe('muted');
  });

  it('pins shared action labels with correct Vietnamese diacritics', () => {
    expect(ADMIN_ACTION).toEqual({
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
    });
  });

  // TL-10: một hàm duy nhất `dd/mm/yyyy hh:mm`, giờ 24h, UTC (múi giờ code
  // admin đang dùng trước M5.0).
  describe('adminDateTime (TL-10)', () => {
    it('formats an ISO timestamp as dd/mm/yyyy hh:mm in 24h UTC', () => {
      expect(adminDateTime('2026-08-11T00:00:00.000Z')).toBe(
        '11/08/2026 00:00',
      );
      expect(adminDateTime('2026-03-04T23:05:00.000Z')).toBe(
        '04/03/2026 23:05',
      );
      expect(adminDateTime('2026-12-31T13:07:59.999Z')).toBe(
        '31/12/2026 13:07',
      );
    });

    it('keeps UTC regardless of the process time zone', () => {
      // TZ của bộ test là Asia/Ho_Chi_Minh (UTC+7); hàm phải trả giờ UTC.
      expect(adminDateTime('2026-08-10T17:30:00.000Z')).toBe(
        '10/08/2026 17:30',
      );
    });

    it('renders an em dash for missing or invalid values', () => {
      expect(adminDateTime(null)).toBe('—');
      expect(adminDateTime(undefined)).toBe('—');
      expect(adminDateTime('')).toBe('—');
      expect(adminDateTime('not-a-date')).toBe('—');
    });
  });
});
