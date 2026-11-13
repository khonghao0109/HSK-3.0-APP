import { describe, expect, it } from 'vitest';

import {
  EXERCISE_VALIDATION_FALLBACK,
  exerciseImportErrorLabel,
  exerciseValidationMessage,
} from './admin-labels';

/** TL-31: mã public của import là chữ HOA, nhãn tra sau khi chuẩn hoá thường. */
describe('admin-labels — lỗi import bài tập (M5.1b2, TL-31)', () => {
  it('mã HOA của import → nhãn tiếng Việt đúng', () => {
    expect(exerciseValidationMessage('SOURCE_KEY_ALREADY_EXISTS')).toBe(
      'Nguồn đã có bài tập với mã nguồn này.',
    );
    expect(exerciseValidationMessage('DUPLICATE_SOURCE_KEY_IN_BATCH')).toBe(
      'Mã nguồn bị trùng trong tệp.',
    );
    expect(exerciseValidationMessage('UNEXPECTED_FIELD')).toBe(
      'Dòng có trường không được hỗ trợ.',
    );
    expect(exerciseValidationMessage('OPTION_ID_NOT_FOUND')).toBe(
      'Đáp án đúng không khớp lựa chọn nào.',
    );
    expect(exerciseValidationMessage('PARENT_LESSON_NOT_FOUND')).toBe(
      'Bài học không tồn tại hoặc chưa xuất bản.',
    );
    expect(exerciseValidationMessage('TOPIC_LESSON_MISMATCH')).toBe(
      'Chủ đề không thuộc bài học đã chọn.',
    );
    expect(exerciseValidationMessage('MEDIA_NOT_FOUND')).toBe(
      'Media không tồn tại.',
    );
  });

  it('mã thường và mã HOA cho cùng một nhãn', () => {
    expect(exerciseValidationMessage('required_field')).toBe(
      exerciseValidationMessage('REQUIRED_FIELD'),
    );
  });

  it('mã lạ → câu chung kèm mã gốc để UI hiện trong <code>', () => {
    expect(exerciseImportErrorLabel('weird_backend_code')).toEqual({
      message: EXERCISE_VALIDATION_FALLBACK,
      unknownCode: 'weird_backend_code',
    });
    expect(exerciseImportErrorLabel('SOURCE_KEY_ALREADY_EXISTS')).toEqual({
      message: 'Nguồn đã có bài tập với mã nguồn này.',
      unknownCode: null,
    });
    expect(exerciseImportErrorLabel(null)).toEqual({
      message: EXERCISE_VALIDATION_FALLBACK,
      unknownCode: null,
    });
  });
});
