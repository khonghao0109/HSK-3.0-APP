/**
 * M5.2a — hằng số và hàm thuần (không Zod) dùng chung cho màn tải media, route
 * BFF và test. Server vẫn là nguồn đúng; client chỉ chặn sớm (TL-39).
 */

/** = MEDIA_UPLOAD_MAX_BYTES (multer `fileSize`) của backend: 10 MiB. */
export const MEDIA_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
/** TL-40: body multipart = tệp + boundary/header; BFF cho dư 64 KiB. */
export const MEDIA_UPLOAD_BFF_MAX_BYTES = MEDIA_UPLOAD_MAX_BYTES + 64 * 1024;
/** TL-38: cùng pattern backend `media-ingestion.policy.ts` (32–128 ký tự). */
export const MEDIA_IDEMPOTENCY_KEY_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{31,127}$/u;
/** TL-40: mã BFF khi backend không trả kịp; client giữ key để thử lại. */
export const MEDIA_UPLOAD_BFF_TIMEOUT_CODE = 'MEDIA_UPLOAD_BFF_TIMEOUT';
export const MEDIA_UPLOAD_ACCEPT = '.jpg,.png,.mp3,.wav';

/** TL-39: MIME chuẩn theo đuôi; backend so MIME khai báo tuyệt đối. */
const CANONICAL_MIME = {
  jpg: 'image/jpeg',
  png: 'image/png',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
} as const;

export type MediaUploadExtension = keyof typeof CANONICAL_MIME;

/** Đúng một dấu chấm, phần tên không rỗng, đuôi trong danh sách (Q102). */
const FILENAME_PATTERN = /^[^.]+\.(jpg|png|mp3|wav)$/iu;

export type MediaFileCheck =
  | { ok: true; extension: MediaUploadExtension; mimeType: string }
  | { ok: false; message: string };

export const MEDIA_UPLOAD_TEXT = {
  hint: 'JPG, PNG, MP3 hoặc WAV, tối đa 10 MB. Tên tệp chỉ có một dấu chấm, ví dụ bai1.wav.',
  jpeg: 'Đuôi .jpeg chưa được nhận. Đổi đuôi tệp thành .jpg rồi chọn lại.',
  name: 'Tên tệp phải có đúng một dấu chấm và đuôi JPG, PNG, MP3 hoặc WAV, ví dụ bai1.wav.',
  empty: 'Tệp rỗng. Chọn tệp có nội dung.',
  tooLarge: 'Tệp vượt quá 10 MB.',
} as const;

export function checkMediaFile(file: {
  name: string;
  size: number;
}): MediaFileCheck {
  const match = FILENAME_PATTERN.exec(file.name);
  if (!match) {
    return {
      ok: false,
      message: /\.jpeg$/iu.test(file.name)
        ? MEDIA_UPLOAD_TEXT.jpeg
        : MEDIA_UPLOAD_TEXT.name,
    };
  }
  if (file.size <= 0) return { ok: false, message: MEDIA_UPLOAD_TEXT.empty };
  if (file.size > MEDIA_UPLOAD_MAX_BYTES) {
    return { ok: false, message: MEDIA_UPLOAD_TEXT.tooLarge };
  }
  const extension = (match[1] ?? '').toLowerCase() as MediaUploadExtension;
  return { ok: true, extension, mimeType: CANONICAL_MIME[extension] };
}

/**
 * Trình duyệt có thể khai `audio/x-wav`, `audio/wave` hoặc `''`; dựng lại part
 * với MIME chuẩn theo đuôi để backend không từ chối vì MIME khai báo (TL-39).
 */
export function canonicalMediaFile(file: File, mimeType: string): File {
  return new File([file], file.name, { type: mimeType });
}
