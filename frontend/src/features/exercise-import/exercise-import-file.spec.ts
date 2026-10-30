import { describe, expect, it } from 'vitest';

import {
  EXERCISE_IMPORT_FILE_MAX_BYTES,
  exerciseImportFileMessage,
  isExerciseImportFileName,
  parseExerciseImportFile,
} from './exercise-import-file';

/** TL-25: client chỉ kiểm cấu trúc tệp, không viết lại validator bài tập. */

function bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

describe('parseExerciseImportFile (TL-25)', () => {
  it('nhận một mảng 100 dòng object', () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      sourceKey: `row-${index + 1}`,
    }));
    const text = JSON.stringify(rows);
    const result = parseExerciseImportFile(text, bytes(text));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toHaveLength(100);
  });

  it('tệp rỗng bị chặn với lý do empty', () => {
    expect(parseExerciseImportFile('', 0)).toEqual({
      ok: false,
      reason: 'empty',
    });
    expect(parseExerciseImportFile('   \n', 4)).toEqual({
      ok: false,
      reason: 'empty',
    });
  });

  it('JSON hỏng báo dòng và cột của lỗi', () => {
    const text = '[\n  { "a": 1 },\n  { "b": }\n]';
    const result = parseExerciseImportFile(text, bytes(text));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid_json');
      if (result.reason === 'invalid_json') {
        expect(result.line).toBe(3);
        expect(result.column).toBeGreaterThan(0);
      }
    }
  });

  it('JSON không phải mảng bị chặn với lý do not_array', () => {
    const text = '{"rows":[]}';
    expect(parseExerciseImportFile(text, bytes(text))).toEqual({
      ok: false,
      reason: 'not_array',
    });
  });

  it('mảng rỗng bị chặn với lý do empty', () => {
    expect(parseExerciseImportFile('[]', 2)).toEqual({
      ok: false,
      reason: 'empty',
    });
  });

  it('101 dòng bị chặn với lý do too_many_rows', () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({
      sourceKey: `row-${index + 1}`,
    }));
    const text = JSON.stringify(rows);
    expect(parseExerciseImportFile(text, bytes(text))).toEqual({
      ok: false,
      reason: 'too_many_rows',
      maxRows: 100,
    });
  });

  it.each([
    ['null', [null]],
    ['mảng lồng', [[]]],
    ['số', [7]],
  ])('phần tử không phải object (%s) bị chặn kèm số dòng', (_label, rows) => {
    const text = JSON.stringify(rows);
    expect(parseExerciseImportFile(text, bytes(text))).toEqual({
      ok: false,
      reason: 'row_not_object',
      rowNumber: 1,
    });
  });

  it('tệp > 90 000 byte bị chặn với lý do oversize', () => {
    const result = parseExerciseImportFile(
      JSON.stringify([{ sourceKey: 'a' }]),
      EXERCISE_IMPORT_FILE_MAX_BYTES + 1,
    );
    expect(result).toEqual({ ok: false, reason: 'oversize' });
  });

  it('nhận đúng byteLength đúng bằng giới hạn 90 000', () => {
    const text = JSON.stringify([{ sourceKey: 'a' }]);
    expect(
      parseExerciseImportFile(text, EXERCISE_IMPORT_FILE_MAX_BYTES).ok,
    ).toBe(true);
  });

  it('chỉ nhận đuôi .json (không phân biệt hoa/thường)', () => {
    expect(isExerciseImportFileName('bai-tap.json')).toBe(true);
    expect(isExerciseImportFileName('BAI-TAP.JSON')).toBe(true);
    expect(isExerciseImportFileName('bai-tap.csv')).toBe(false);
    expect(isExerciseImportFileName('json')).toBe(false);
  });

  it('câu lỗi tiếng Việt cho từng lý do', () => {
    expect(exerciseImportFileMessage({ reason: 'oversize' })).toBe(
      'Tệp tối đa 90 KB.',
    );
    expect(
      exerciseImportFileMessage({
        reason: 'invalid_json',
        line: 3,
        column: 5,
      }),
    ).toContain('dòng 3, cột 5');
    expect(
      exerciseImportFileMessage({ reason: 'row_not_object', rowNumber: 4 }),
    ).toContain('Dòng 4');
  });
});
