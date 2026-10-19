import { describe, expect, it } from 'vitest';

import {
  ADMIN_ACTION,
  ADMIN_DATETIME_FORMAT,
  adminDateTime,
  badgeTone,
  contentConflictMessage,
  contentStatusLabel,
  exerciseStatusLabel,
  exerciseTypeLabel,
  levelLabel,
  lifecycleLabel,
  mediaTypeLabel,
  processingStatusLabel,
  reviewDecisionLabel,
  revisionReviewStateLabel,
  revisionReviewStateTone,
  topicTypeLabel,
} from './admin-labels';

// Chốt bảng thuật ngữ M5.0: đổi nhãn ở đây là đổi cả admin, nên mỗi ánh xạ
// có test khóa đúng chữ tiếng Việt (kể cả dấu "Huỷ", không phải "Hủy").
describe('admin-labels', () => {
  it('maps exercise and content statuses to Vietnamese', () => {
    for (const label of [exerciseStatusLabel, contentStatusLabel]) {
      expect(label('draft')).toBe('Bản nháp');
      expect(label('published')).toBe('Đã xuất bản');
      expect(label('archived')).toBe('Đã lưu trữ');
    }
  });

  it('maps topic types to Vietnamese (M5.1a)', () => {
    expect(topicTypeLabel('vocabulary')).toBe('Từ vựng');
    expect(topicTypeLabel('grammar')).toBe('Ngữ pháp');
    expect(topicTypeLabel('key_text')).toBe('Bài đọc chính');
    expect(topicTypeLabel('quiz')).toBe('Trắc nghiệm');
    expect(topicTypeLabel('ai_speaking')).toBe('Luyện nói AI');
    expect(topicTypeLabel('future_type')).toBe('future_type');
  });

  it('maps latest-revision review state to Vietnamese (TL-11)', () => {
    expect(revisionReviewStateLabel(null)).toBe('—');
    expect(revisionReviewStateLabel(undefined)).toBe('—');
    expect(revisionReviewStateLabel({ reviews: [] })).toBe('Chờ duyệt');
    expect(
      revisionReviewStateLabel({ reviews: [{ decision: 'approved' }] }),
    ).toBe('Đã duyệt');
    expect(
      revisionReviewStateLabel({
        reviews: [{ decision: 'changes_requested' }],
      }),
    ).toBe('Cần sửa');
    expect(
      revisionReviewStateLabel({ reviews: [{ decision: 'rejected' }] }),
    ).toBe('Từ chối');
    expect(revisionReviewStateTone(null)).toBe('muted');
    expect(revisionReviewStateTone({ reviews: [] })).toBe('draft');
    expect(
      revisionReviewStateTone({ reviews: [{ decision: 'approved' }] }),
    ).toBe('ok');
    expect(
      revisionReviewStateTone({ reviews: [{ decision: 'rejected' }] }),
    ).toBe('danger');
  });

  it('maps CMS 409 codes to Vietnamese sentences (TL-14)', () => {
    expect(contentConflictMessage('CONTENT_ARCHIVED')).toBe(
      'Nội dung đã lưu trữ, không thể thay đổi.',
    );
    expect(contentConflictMessage('REVISION_NOT_LATEST')).toContain(
      'không còn là bản mới nhất',
    );
    expect(contentConflictMessage('REVIEW_NOT_APPROVED')).toContain(
      'phải được duyệt trước khi xuất bản',
    );
    expect(contentConflictMessage('LESSON_LEVEL_NOT_PUBLISHED')).toContain(
      'Cấp độ',
    );
    expect(contentConflictMessage('LESSON_NO_PUBLISHED_CHILD')).toContain(
      'ít nhất một chủ đề hoặc truyện đã xuất bản',
    );
    expect(contentConflictMessage('CONTENT_UNIQUE_CONFLICT')).toContain(
      'Slug hoặc thứ tự',
    );
    expect(contentConflictMessage('CONTENT_CONSTRAINT_CONFLICT')).toContain(
      'ràng buộc dữ liệu',
    );
    expect(contentConflictMessage('CONTENT_CONCURRENT_UPDATE')).toContain(
      'vừa cập nhật',
    );
    expect(contentConflictMessage('CONTENT_REVISION_INVALID')).toContain(
      'Bản sửa không hợp lệ',
    );
    // Mã lạ hoặc thiếu → câu chung.
    expect(contentConflictMessage('SOMETHING_NEW')).toBe(
      contentConflictMessage(null),
    );
    expect(contentConflictMessage(undefined)).toContain('xung đột');
  });

  it('formats level codes as HSK labels (TL-12)', () => {
    expect(levelLabel('HSK1')).toBe('HSK 1');
    expect(levelLabel('HSK6')).toBe('HSK 6');
    expect(levelLabel('HSK7_9')).toBe('HSK 7–9');
    expect(levelLabel('OTHER')).toBe('OTHER');
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

  // Q95 (thay TL-10): một hàm duy nhất `dd/mm/yyyy hh:mm`, giờ 24h, múi giờ
  // Asia/Ho_Chi_Minh, không ghi nhãn múi giờ.
  describe('adminDateTime (Q95)', () => {
    it('formats an ISO timestamp as dd/mm/yyyy hh:mm in 24h Asia/Ho_Chi_Minh', () => {
      expect(adminDateTime('2026-08-11T00:00:00.000Z')).toBe(
        '11/08/2026 07:00',
      );
      expect(adminDateTime('2026-03-04T23:05:00.000Z')).toBe(
        '05/03/2026 06:05',
      );
      expect(adminDateTime('2026-12-31T13:07:59.999Z')).toBe(
        '31/12/2026 20:07',
      );
    });

    it('matches the Q95 unit cases across midnight and year boundaries', () => {
      expect(adminDateTime('2026-10-15T22:26:00Z')).toBe('16/10/2026 05:26');
      expect(adminDateTime('2026-12-31T17:00:00Z')).toBe('01/01/2027 00:00');
    });

    it('keeps Asia/Ho_Chi_Minh regardless of the process time zone', () => {
      // Múi giờ cố định qua Intl timeZone; giá trị này ở UTC là 10/08 17:30
      // nên nếu code trượt về UTC (TL-10 cũ) test sẽ đỏ.
      expect(adminDateTime('2026-08-10T17:30:00.000Z')).toBe(
        '11/08/2026 00:30',
      );
    });

    it('pins the formatter time zone and crosses the calendar day (S3)', () => {
      // 15/10 17:30 UTC = 16/10 00:30 giờ VN: UTC và Asia/Ho_Chi_Minh khác
      // ngày, nên nếu formatter trượt về UTC kết quả sẽ sai ngày.
      expect(adminDateTime('2026-10-15T17:30:00.000Z')).toBe(
        '16/10/2026 00:30',
      );
      // Máy chạy có thể cùng UTC+7 (Asia/Saigon) nên so ngày không đủ. ICU
      // canonical hoá Asia/Ho_Chi_Minh → Asia/Saigon ở một số runtime, nên
      // chấp nhận cả hai dạng canonical của cùng múi giờ.
      expect(['Asia/Ho_Chi_Minh', 'Asia/Saigon']).toContain(
        ADMIN_DATETIME_FORMAT.resolvedOptions().timeZone,
      );
      expect(ADMIN_DATETIME_FORMAT.resolvedOptions().hourCycle).toBe('h23');
    });

    it('gives the same result when process.env.TZ changes (R15)', () => {
      const previous = process.env.TZ;
      try {
        for (const zone of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
          process.env.TZ = zone;
          expect(adminDateTime('2026-08-10T17:30:00.000Z')).toBe(
            '11/08/2026 00:30',
          );
          expect(adminDateTime('2026-12-31T17:00:00Z')).toBe(
            '01/01/2027 00:00',
          );
        }
      } finally {
        if (previous === undefined) delete process.env.TZ;
        else process.env.TZ = previous;
      }
    });

    it('renders an em dash for missing or invalid values', () => {
      expect(adminDateTime(null)).toBe('—');
      expect(adminDateTime(undefined)).toBe('—');
      expect(adminDateTime('')).toBe('—');
      expect(adminDateTime('not-a-date')).toBe('—');
    });
  });
});
