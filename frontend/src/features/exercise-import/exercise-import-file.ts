/**
 * TL-25 — client chỉ kiểm CẤU TRÚC tệp, không viết lại validator bài tập:
 * đuôi .json, ≤ 90 000 byte, JSON.parse được, là mảng, 1–100 phần tử, mỗi
 * phần tử là object (không mảng/null). Nội dung từng bài do backend preview
 * kiểm. Module thuần, không import gì (theo mẫu content/topic-json.ts) nên
 * client component dùng được mà không kéo Zod vào bundle.
 */

export const EXERCISE_IMPORT_FILE_MAX_BYTES = 90_000;
export const EXERCISE_IMPORT_FILE_MAX_ROWS = 100;

export type ExerciseImportFileError =
  | { reason: 'not_json_extension' }
  | { reason: 'oversize' }
  | { reason: 'invalid_json'; line?: number; column?: number }
  | { reason: 'not_array' }
  | { reason: 'empty' }
  | { reason: 'too_many_rows'; maxRows: number }
  | { reason: 'row_not_object'; rowNumber: number };

export type ExerciseImportFileResult =
  { ok: true; rows: unknown[] } | ({ ok: false } & ExerciseImportFileError);

/** TL-25: chỉ nhận tệp có đuôi `.json` (không phân biệt hoa/thường). */
export function isExerciseImportFileName(fileName: string): boolean {
  return /\.json$/iu.test(fileName.trim());
}

/**
 * `byteLength` là kích thước tệp thật (File.size) chứ không phải độ dài chuỗi:
 * ký tự tiếng Hán chiếm nhiều byte UTF-8 hơn.
 */
export function parseExerciseImportFile(
  text: string,
  byteLength: number,
): ExerciseImportFileResult {
  if (!Number.isFinite(byteLength) || byteLength < 0) {
    return { ok: false, reason: 'invalid_json' };
  }
  if (byteLength > EXERCISE_IMPORT_FILE_MAX_BYTES) {
    return { ok: false, reason: 'oversize' };
  }
  if (text.trim().length === 0) return { ok: false, reason: 'empty' };

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid_json',
      ...locateJsonError(text, error),
    };
  }
  if (!Array.isArray(value)) return { ok: false, reason: 'not_array' };
  if (value.length === 0) return { ok: false, reason: 'empty' };
  if (value.length > EXERCISE_IMPORT_FILE_MAX_ROWS) {
    return {
      ok: false,
      reason: 'too_many_rows',
      maxRows: EXERCISE_IMPORT_FILE_MAX_ROWS,
    };
  }
  for (const [index, row] of value.entries()) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      return { ok: false, reason: 'row_not_object', rowNumber: index + 1 };
    }
  }
  return { ok: true, rows: value };
}

/**
 * V8 báo vị trí lỗi theo `at position N (line X column Y)` (Node ≥ 20),
 * `at line X column Y`, hoặc chỉ `at position N`; một số lỗi không có vị trí.
 */
function locateJsonError(
  text: string,
  error: unknown,
): { line?: number; column?: number } {
  const message = error instanceof Error ? error.message : '';
  const lineColumn = /at line (\d+) column (\d+)/u.exec(message);
  if (lineColumn) {
    return { line: Number(lineColumn[1]), column: Number(lineColumn[2]) };
  }
  const position = /at position (\d+)/u.exec(message);
  if (position) return positionToLineColumn(text, Number(position[1]));
  return locateByScanner(text);
}

/**
 * Node 24 đôi khi báo `Unexpected token '}' ... is not valid JSON` mà KHÔNG
 * kèm position. Fallback quét cú pháp JSON tối thiểu để lấy vị trí lỗi đầu
 * tiên (tệp ≤ 90 000 byte nên chi phí tuyến tính này chấp nhận được).
 */
function locateByScanner(text: string): { line?: number; column?: number } {
  const scanner = new JsonScanner(text);
  const position = scanner.firstErrorPosition();
  return position === null ? {} : positionToLineColumn(text, position);
}

class JsonScanError extends Error {
  constructor(readonly position: number) {
    super('json-scan-error');
    this.name = 'JsonScanError';
  }
}

class JsonScanner {
  private index = 0;
  private readonly length: number;

  constructor(private readonly text: string) {
    this.length = text.length;
  }

  firstErrorPosition(): number | null {
    try {
      this.parseValue();
      this.skipWhitespace();
      if (this.index < this.length) throw new JsonScanError(this.index);
      return null;
    } catch (error) {
      return error instanceof JsonScanError ? error.position : null;
    }
  }

  private fail(): never {
    throw new JsonScanError(this.index);
  }

  private skipWhitespace() {
    while (this.index < this.length) {
      const code = this.text.charCodeAt(this.index);
      if (code === 32 || code === 9 || code === 10 || code === 13) {
        this.index += 1;
      } else {
        break;
      }
    }
  }

  private parseValue() {
    this.skipWhitespace();
    if (this.index >= this.length) this.fail();
    const char = this.text[this.index];
    if (char === '"') return this.parseString();
    if (char === '{') return this.parseObject();
    if (char === '[') return this.parseArray();
    if (char === 't') return this.parseLiteral('true');
    if (char === 'f') return this.parseLiteral('false');
    if (char === 'n') return this.parseLiteral('null');
    return this.parseNumber();
  }

  private parseString() {
    this.index += 1;
    while (this.index < this.length) {
      const code = this.text.charCodeAt(this.index);
      if (code === 34) {
        this.index += 1;
        return;
      }
      if (code === 92) {
        this.index += 2;
        continue;
      }
      if (code < 32) this.fail();
      this.index += 1;
    }
    throw new JsonScanError(this.length);
  }

  private parseLiteral(word: string) {
    if (!this.text.startsWith(word, this.index)) this.fail();
    this.index += word.length;
  }

  private parseNumber() {
    const isDigit = (code: number) => code >= 48 && code <= 57;
    if (this.text[this.index] === '-') this.index += 1;
    if (this.index >= this.length) this.fail();
    if (this.text[this.index] === '0') {
      this.index += 1;
    } else if (isDigit(this.text.charCodeAt(this.index))) {
      while (
        this.index < this.length &&
        isDigit(this.text.charCodeAt(this.index))
      ) {
        this.index += 1;
      }
    } else {
      this.fail();
    }
    if (this.text[this.index] === '.') {
      this.index += 1;
      if (!isDigit(this.text.charCodeAt(this.index))) this.fail();
      while (
        this.index < this.length &&
        isDigit(this.text.charCodeAt(this.index))
      ) {
        this.index += 1;
      }
    }
    const exponent = this.text[this.index];
    if (exponent === 'e' || exponent === 'E') {
      this.index += 1;
      const sign = this.text[this.index];
      if (sign === '+' || sign === '-') this.index += 1;
      if (!isDigit(this.text.charCodeAt(this.index))) this.fail();
      while (
        this.index < this.length &&
        isDigit(this.text.charCodeAt(this.index))
      ) {
        this.index += 1;
      }
    }
  }

  private parseArray() {
    this.index += 1;
    this.skipWhitespace();
    if (this.text[this.index] === ']') {
      this.index += 1;
      return;
    }
    for (;;) {
      this.parseValue();
      this.skipWhitespace();
      if (this.text[this.index] === ',') {
        this.index += 1;
        continue;
      }
      if (this.text[this.index] === ']') {
        this.index += 1;
        return;
      }
      this.fail();
    }
  }

  private parseObject() {
    this.index += 1;
    this.skipWhitespace();
    if (this.text[this.index] === '}') {
      this.index += 1;
      return;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.index] !== '"') this.fail();
      this.parseString();
      this.skipWhitespace();
      if (this.text[this.index] !== ':') this.fail();
      this.index += 1;
      this.parseValue();
      this.skipWhitespace();
      if (this.text[this.index] === ',') {
        this.index += 1;
        continue;
      }
      if (this.text[this.index] === '}') {
        this.index += 1;
        return;
      }
      this.fail();
    }
  }
}

function positionToLineColumn(
  text: string,
  position: number,
): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  const end = Math.min(Math.max(position, 0), text.length);
  for (let index = 0; index < end; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: end - lineStart + 1 };
}

/** Câu tiếng Việt cho lỗi cấu trúc tệp (TL-25/TL-30/TL-32). */
export function exerciseImportFileMessage(
  error: ExerciseImportFileError,
): string {
  switch (error.reason) {
    case 'not_json_extension':
      return 'Chỉ nhận tệp .json.';
    case 'oversize':
      return 'Tệp tối đa 90 KB.';
    case 'invalid_json':
      if (error.line !== undefined && error.column !== undefined) {
        return `Tệp JSON không hợp lệ (dòng ${error.line}, cột ${error.column}).`;
      }
      return 'Tệp JSON không hợp lệ.';
    case 'not_array':
      return 'Tệp phải là một mảng bài tập.';
    case 'empty':
      return 'Tệp không có dòng nào.';
    case 'too_many_rows':
      return `Tệp có quá ${error.maxRows} dòng.`;
    case 'row_not_object':
      return `Dòng ${error.rowNumber} không phải là một đối tượng.`;
  }
}
