/**
 * Parse nội dung JSON của Topic soạn trong một ô textarea (Q90). Module thuần
 * (không import gì, không Zod) nên client component và route handler BFF cùng
 * dùng được mà không kéo Zod vào client bundle (client-bundle-guard).
 *
 * Client KHÔNG dùng module này để chặn submit — việc kiểm cú pháp/kích thước
 * là của server (route BFF parse trước khi gọi backend, backend kiểm depth
 * ≤20). Giới hạn byte khớp `BoundedJsonPayload` của backend (≤ 100 000 byte).
 */

export const TOPIC_JSON_MAX_BYTES = 100_000;

export type TopicJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; oversize: true }
  | { ok: false; oversize: false; line?: number; column?: number };

export function parseTopicJson(text: string): TopicJsonResult {
  if (new TextEncoder().encode(text).length > TOPIC_JSON_MAX_BYTES) {
    return { ok: false, oversize: true };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, oversize: false, ...locateJsonError(text, error) };
  }
}

/**
 * V8 báo vị trí lỗi JSON theo các dạng: `... at position N (line X column Y)`
 * (Node ≥ 20), `... at line X column Y`, hoặc bản cũ chỉ `... at position N`.
 * Một số lỗi (vd input kết thúc giữa chừng) không có vị trí — trả object
 * rỗng, UI hiện câu chung.
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
  if (position) {
    return positionToLineColumn(text, Number(position[1]));
  }
  return {};
}

/** Offset 0-based → line/column 1-based, đếm theo ký tự xuống dòng `\n`. */
function positionToLineColumn(
  text: string,
  position: number,
): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  const end = Math.min(position, text.length);
  for (let index = 0; index < end; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: position - lineStart + 1 };
}
