/**
 * Nhãn tiếng Việt cho mọi enum và hành động hiện trong admin (M5.0, Q4/Q88).
 *
 * Đây là CHỖ DUY NHẤT đặt nhãn enum: mọi trang admin import từ đây, không tự
 * dịch rải rác. Module thuần (không import gì) để client component dùng được
 * mà không kéo Zod vào bundle (frontend/AGENTS.md, client-bundle-guard).
 *
 * Giá trị lạ (backend thêm enum mới) rơi về chính chuỗi gốc để không vỡ UI.
 */

/* Bài tập & nội dung (lesson/topic): Bản nháp / Đã xuất bản / Đã lưu trữ */
const CONTENT_STATUS: Record<string, string> = {
  draft: 'Bản nháp',
  published: 'Đã xuất bản',
  archived: 'Đã lưu trữ',
};

/* Duyệt nội dung: Đã duyệt / Cần sửa / Từ chối */
const REVIEW_DECISION: Record<string, string> = {
  approved: 'Đã duyệt',
  changes_requested: 'Cần sửa',
  rejected: 'Từ chối',
};

/* Loại bài tập: Trắc nghiệm / Điền vào chỗ trống / Nghe chọn đáp án /
   Sắp xếp câu / Nói lặp lại */
const EXERCISE_TYPE: Record<string, string> = {
  mcq: 'Trắc nghiệm',
  fill_blank: 'Điền vào chỗ trống',
  listening_choice: 'Nghe chọn đáp án',
  arrange_sentence: 'Sắp xếp câu',
  speaking_repeat: 'Nói lặp lại',
};

/* Loại chủ đề (M5.1a): Từ vựng / Ngữ pháp / Bài đọc chính / Trắc nghiệm /
   Luyện nói AI */
const TOPIC_TYPE: Record<string, string> = {
  vocabulary: 'Từ vựng',
  grammar: 'Ngữ pháp',
  key_text: 'Bài đọc chính',
  quiz: 'Trắc nghiệm',
  ai_speaking: 'Luyện nói AI',
};

/* Loại media: Âm thanh / Hình ảnh / PDF / Video */
const MEDIA_TYPE: Record<string, string> = {
  audio: 'Âm thanh',
  image: 'Hình ảnh',
  pdf: 'PDF',
  video: 'Video',
};

/* Xử lý media: Chờ xử lý / Đang xử lý / Sẵn sàng / Lỗi xử lý / Đã cách ly */
const PROCESSING_STATUS: Record<string, string> = {
  pending: 'Chờ xử lý',
  processing: 'Đang xử lý',
  ready: 'Sẵn sàng',
  failed: 'Lỗi xử lý',
  quarantined: 'Đã cách ly',
};

/* Vòng đời media: Đang dùng / Đã lưu trữ */
const LIFECYCLE: Record<string, string> = {
  active: 'Đang dùng',
  archived: 'Đã lưu trữ',
};

export function exerciseStatusLabel(status: string): string {
  return CONTENT_STATUS[status] ?? status;
}

export function contentStatusLabel(status: string): string {
  return CONTENT_STATUS[status] ?? status;
}

export function topicTypeLabel(type: string): string {
  return TOPIC_TYPE[type] ?? type;
}

/**
 * "Trạng thái duyệt" của bản sửa mới nhất (TL-11): không có bản sửa → '—';
 * chưa có đánh giá → 'Chờ duyệt'; còn lại theo quyết định mới nhất
 * (Đã duyệt / Cần sửa / Từ chối).
 */
export function revisionReviewStateLabel(
  latestRevision: { reviews: { decision: string }[] } | null | undefined,
): string {
  if (!latestRevision) return '—';
  const decision = latestRevision.reviews[0]?.decision;
  if (!decision) return 'Chờ duyệt';
  return REVIEW_DECISION[decision] ?? decision;
}

/** Tông badge tương ứng "Trạng thái duyệt" (TL-11): chờ duyệt = amber. */
export function revisionReviewStateTone(
  latestRevision: { reviews: { decision: string }[] } | null | undefined,
): AdminBadgeTone {
  if (!latestRevision) return 'muted';
  const decision = latestRevision.reviews[0]?.decision;
  if (!decision) return 'draft';
  return badgeTone(decision);
}

/**
 * Mã 409 của CMS (backend B2, TL-14) → câu tiếng Việt hiển thị trong vùng
 * lỗi. Mã lạ rơi về câu chung; message tiếng Anh của backend không hiển thị.
 */
const CONTENT_CONFLICT_MESSAGE: Record<string, string> = {
  CONTENT_ARCHIVED: 'Nội dung đã lưu trữ, không thể thay đổi.',
  REVISION_NOT_LATEST:
    'Bản sửa này không còn là bản mới nhất. Tải lại trang rồi thử lại.',
  REVIEW_NOT_APPROVED: 'Bản sửa mới nhất phải được duyệt trước khi xuất bản.',
  LESSON_LEVEL_NOT_PUBLISHED:
    'Cấp độ của bài học chưa xuất bản nên chưa thể xuất bản bài học.',
  LESSON_NO_PUBLISHED_CHILD:
    'Bài học cần ít nhất một chủ đề hoặc truyện đã xuất bản trước khi xuất bản.',
  CONTENT_UNIQUE_CONFLICT:
    'Slug hoặc thứ tự đã được dùng cho nội dung khác. Chọn giá trị khác.',
  CONTENT_CONSTRAINT_CONFLICT:
    'Nội dung vi phạm ràng buộc dữ liệu. Kiểm tra lại các trường liên kết.',
  CONTENT_CONCURRENT_UPDATE:
    'Có người vừa cập nhật nội dung này. Tải lại trang rồi thử lại.',
  CONTENT_REVISION_INVALID: 'Bản sửa không hợp lệ. Tải lại trang rồi thử lại.',
  // M5.1b1 (F5): 409 riêng của bài tập.
  TOPIC_LESSON_MISMATCH:
    'Chủ đề không thuộc bài học của bài tập hoặc chủ đề không còn hiệu lực.',
};

const CONTENT_CONFLICT_FALLBACK =
  'Thao tác xung đột với dữ liệu hiện tại. Tải lại trang rồi thử lại.';

export function contentConflictMessage(
  code: string | null | undefined,
): string {
  if (!code) return CONTENT_CONFLICT_FALLBACK;
  return CONTENT_CONFLICT_MESSAGE[code] ?? CONTENT_CONFLICT_FALLBACK;
}

/**
 * M5.1b1 (F5, TL-20): nhãn tiếng Việt cho mọi mã 422 của
 * `lesson-exercise-authoring.validator.ts`, `exercise-publish-readiness.ts` và
 * `EXERCISE_TYPE_NOT_PUBLISHABLE` của `exercise-authoring.service.ts`. Mã lạ
 * rơi về câu chung; message tiếng Anh của backend không hiển thị.
 */
const EXERCISE_VALIDATION_MESSAGE: Record<string, string> = {
  // service (422)
  EXERCISE_TYPE_NOT_PUBLISHABLE: 'Loại này chưa xuất bản được.',
  listening_media_not_ready: 'Audio phải sẵn sàng và chưa bị xoá.',
  // lesson-exercise-authoring.validator.ts
  required_field: 'Thiếu trường bắt buộc.',
  invalid_exercise_type: 'Loại bài tập không hợp lệ.',
  unsupported_publish_type: 'Loại bài tập này chưa xuất bản được.',
  object_required: 'Dữ liệu phải là một đối tượng hợp lệ.',
  unknown_field: 'Dữ liệu có trường không được hỗ trợ.',
  array_required: 'Trường này phải là danh sách.',
  array_too_small: 'Danh sách chưa đủ phần tử tối thiểu.',
  array_too_large: 'Danh sách vượt quá số phần tử cho phép.',
  duplicate_stable_id: 'Mã phần tử bị trùng. Tải lại trang rồi thử lại.',
  invalid_stable_id: 'Mã phần tử không hợp lệ.',
  authoritative_option_not_found: 'Đáp án đúng phải là một lựa chọn đã nhập.',
  accepted_texts_required: 'Cần ít nhất một đáp án chấp nhận.',
  boolean_required: 'Giá trị phải là đúng/sai.',
  invalid_token_set: 'Các mảnh câu phải khớp đúng danh sách đã nhập.',
  media_not_allowed: 'Chỉ câu nghe chọn mới có audio.',
  media_required: 'Câu nghe chọn cần audio.',
  positive_safe_integer_required: 'Giá trị phải là số nguyên dương.',
  max_depth_exceeded: 'Dữ liệu lồng quá sâu.',
  invalid_json: 'Dữ liệu JSON không hợp lệ.',
  payload_too_large: 'Dữ liệu quá lớn (tối đa 65 536 byte).',
  string_required: 'Trường này phải là chuỗi.',
  non_empty_string_required: 'Trường này không được để trống.',
  string_too_long: 'Trường này quá dài (tối đa 4 096 ký tự).',
};

export const EXERCISE_VALIDATION_FALLBACK =
  'Dữ liệu bài tập không hợp lệ. Kiểm tra lại các ô được đánh dấu.';

export function exerciseValidationMessage(
  code: string | null | undefined,
): string {
  if (!code) return EXERCISE_VALIDATION_FALLBACK;
  return EXERCISE_VALIDATION_MESSAGE[code] ?? EXERCISE_VALIDATION_FALLBACK;
}

/** TL-19 (F5): nhãn form bài tập dùng chung cho 5 loại. */
export const EXERCISE_FORM = {
  type: 'Loại bài tập',
  prompt: 'Đề bài',
  explanation: 'Giải thích',
  orderIndex: 'Thứ tự',
  options: 'Lựa chọn',
  correctAnswer: 'Đáp án đúng',
  addOption: 'Thêm lựa chọn',
  remove: 'Xoá',
  audio: 'Audio',
  acceptedTexts: 'Đáp án chấp nhận',
  caseSensitive: 'Phân biệt chữ hoa/thường',
  tokens: 'Mảnh câu',
  moveUp: 'Lên',
  moveDown: 'Xuống',
  referenceText: 'Câu mẫu',
  submitCreate: 'Tạo bài tập',
  submitRevision: 'Lưu bản sửa',
} as const;

/** TL-19: 5 loại trong ô "Loại bài tập" (nhãn ngắn của form). */
export const EXERCISE_FORM_TYPE_OPTIONS = [
  { value: 'mcq', label: 'Trắc nghiệm' },
  { value: 'listening_choice', label: 'Nghe chọn' },
  { value: 'fill_blank', label: 'Điền từ' },
  { value: 'arrange_sentence', label: 'Sắp xếp câu' },
  { value: 'speaking_repeat', label: 'Luyện nói' },
] as const;

/** TL-19: câu kiểm client cạnh ô (dùng aria-describedby + focus ô lỗi đầu). */
export const EXERCISE_FORM_MESSAGE = {
  typeRequired: 'Chọn loại bài tập.',
  promptRequired: 'Nhập đề bài (tối đa 4 096 ký tự).',
  explanationTooLong: 'Giải thích tối đa 4 096 ký tự.',
  orderIndexInvalid: 'Thứ tự phải là số từ 1 đến 1 000 000.',
  optionsRange: 'Cần từ 2 đến 100 lựa chọn.',
  optionTextRequired: 'Nhập nội dung lựa chọn.',
  correctAnswerRequired: 'Chọn một đáp án đúng.',
  audioRequired: 'Chọn audio đã sẵn sàng cho câu nghe.',
  acceptedTextsRange: 'Cần từ 1 đến 100 đáp án chấp nhận.',
  acceptedTextRequired: 'Nhập đáp án chấp nhận.',
  tokensRange: 'Cần từ 2 đến 100 mảnh câu.',
  tokenTextRequired: 'Nhập nội dung mảnh câu.',
  referenceTextTooLong: 'Câu mẫu tối đa 4 096 ký tự.',
  generic: 'Kiểm tra lại các ô được đánh dấu.',
} as const;

/** `HSK1` → `HSK 1`; `HSK7_9` → `HSK 7–9` (Q3, TL-12). Mã lạ trả nguyên. */
export function levelLabel(code: string): string {
  const range = /^HSK(\d+)_(\d+)$/u.exec(code);
  if (range) return `HSK ${range[1]}–${range[2]}`;
  const single = /^HSK(\d+)$/u.exec(code);
  return single ? `HSK ${single[1]}` : code;
}

export function reviewDecisionLabel(decision: string): string {
  return REVIEW_DECISION[decision] ?? decision;
}

export function exerciseTypeLabel(type: string): string {
  return EXERCISE_TYPE[type] ?? type;
}

export function mediaTypeLabel(type: string): string {
  return MEDIA_TYPE[type] ?? type;
}

export function processingStatusLabel(status: string): string {
  return PROCESSING_STATUS[status] ?? status;
}

export function lifecycleLabel(lifecycle: string): string {
  return LIFECYCLE[lifecycle] ?? lifecycle;
}

/**
 * Tông badge theo mẫu admin (docs/ui_reference/admin/css/admin.css
 * `.status--*`): ok = jade, draft = amber, info = blue, danger = red,
 * muted = slate. Enum lạ rơi về muted.
 */
export type AdminBadgeTone = 'ok' | 'draft' | 'muted' | 'danger' | 'info';

const BADGE_TONE: Record<string, AdminBadgeTone> = {
  published: 'ok',
  approved: 'ok',
  ready: 'ok',
  active: 'ok',
  draft: 'draft',
  pending: 'draft',
  changes_requested: 'draft',
  processing: 'info',
  failed: 'danger',
  quarantined: 'danger',
  rejected: 'danger',
  archived: 'muted',
};

export function badgeTone(status: string): AdminBadgeTone {
  return BADGE_TONE[status] ?? 'muted';
}

/* Hành động và vai trò dùng chung (Cách ly · Lưu trữ · Huỷ · Thử lại ·
   Trước · Sau · Đăng nhập · Đăng xuất · Sắp có · Quản trị viên). */
export const ADMIN_ACTION = {
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
} as const;

/**
 * Ngày giờ admin (Q95, thay TL-10): `dd/mm/yyyy hh:mm`, giờ 24h, múi giờ
 * Asia/Ho_Chi_Minh (UTC+7), không ghi nhãn múi giờ. Múi giờ cố định trong
 * Intl.DateTimeFormat nên kết quả độc lập với TZ của máy chạy. Giá trị thiếu
 * hoặc không hợp lệ trả '—'. Mọi chỗ admin hiện ngày dùng hàm này.
 */
/**
 * S3: export để test khoá được múi giờ thật sự dùng
 * (`resolvedOptions().timeZone`), không chỉ so chuỗi ngày — máy chạy có thể
 * cùng UTC+7 (Asia/Saigon) nên so ngày không phân biệt được.
 */
export const ADMIN_DATETIME_FORMAT = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hourCycle: 'h23',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function adminDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const parts: Record<string, string> = {};
  for (const part of ADMIN_DATETIME_FORMAT.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}
