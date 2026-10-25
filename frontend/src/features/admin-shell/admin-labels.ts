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

/* Loại câu hỏi ngân hàng (M4.1a, Q112): Trắc nghiệm / Đúng-Sai / Điền từ /
   Sắp xếp câu */
const QUESTION_TYPE: Record<string, string> = {
  mcq: 'Trắc nghiệm',
  true_false: 'Đúng/Sai',
  fill_blank: 'Điền từ',
  arrange_sentence: 'Sắp xếp câu',
};

/* Kỹ năng câu hỏi (Q113): Nghe hiểu / Đọc hiểu / Viết / Nói */
const SKILL: Record<string, string> = {
  listening: 'Nghe hiểu',
  reading: 'Đọc hiểu',
  writing: 'Viết',
  speaking: 'Nói',
};

/* Trạng thái câu hỏi (TL-89): Bản nháp / Đã xuất bản / Lưu trữ */
const QUESTION_STATUS: Record<string, string> = {
  draft: 'Bản nháp',
  published: 'Đã xuất bản',
  archived: 'Lưu trữ',
};

/* Độ khó câu hỏi: Dễ / Trung bình / Khó */
const DIFFICULTY: Record<string, string> = {
  '1': 'Dễ',
  '2': 'Trung bình',
  '3': 'Khó',
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
  // M5.1b2 (TL-31): mã public của import bài tập (backend A.9). Mã public là
  // chữ HOA; `exerciseValidationMessage` chuẩn hoá về chữ thường trước khi tra.
  source_key_already_exists: 'Nguồn đã có bài tập với mã nguồn này.',
  duplicate_source_key_in_batch: 'Mã nguồn bị trùng trong tệp.',
  unexpected_field: 'Dòng có trường không được hỗ trợ.',
  option_id_not_found: 'Đáp án đúng không khớp lựa chọn nào.',
  parent_lesson_not_found: 'Bài học không tồn tại hoặc chưa xuất bản.',
  topic_lesson_mismatch: 'Chủ đề không thuộc bài học đã chọn.',
  media_not_found: 'Media không tồn tại.',
  invalid_source_key: 'Mã nguồn không hợp lệ.',
  invalid_row: 'Dòng dữ liệu không hợp lệ.',
};

export const EXERCISE_VALIDATION_FALLBACK =
  'Dữ liệu bài tập không hợp lệ. Kiểm tra lại các ô được đánh dấu.';

export function exerciseValidationMessage(
  code: string | null | undefined,
): string {
  if (!code) return EXERCISE_VALIDATION_FALLBACK;
  const normalized = code.toLowerCase();
  for (const [key, message] of Object.entries(EXERCISE_VALIDATION_MESSAGE)) {
    if (key.toLowerCase() === normalized) return message;
  }
  return EXERCISE_VALIDATION_FALLBACK;
}

/**
 * M4.1a (TL-91): nhãn tiếng Việt cho mọi mã máy của ngân hàng câu hỏi.
 * Message tiếng Anh của backend không hiển thị ra UI.
 */
const QUESTION_CONFLICT_MESSAGE: Record<string, string> = {
  QUESTION_ARCHIVED: 'Câu hỏi đã lưu trữ, không thể thay đổi.',
  QUESTION_NOT_PUBLISHABLE: 'Câu hỏi chưa đủ điều kiện xuất bản.',
  QUESTION_IN_PUBLISHED_TEST:
    'Câu hỏi đang thuộc một đề thi đã xuất bản nên không thể lưu trữ.',
  MEDIA_NOT_USABLE:
    'Media không dùng được: phải tồn tại, đúng loại, chưa bị cách ly và chưa bị xoá.',
  REVISION_NOT_LATEST:
    'Bản sửa này không còn là bản mới nhất. Tải lại trang rồi thử lại.',
  REVIEW_NOT_APPROVED: 'Bản sửa mới nhất phải được duyệt trước khi xuất bản.',
  QUESTION_UNIQUE_CONFLICT:
    'Dữ liệu câu hỏi hoặc chủ đề bị trùng. Kiểm tra lại rồi thử lại.',
  QUESTION_CONSTRAINT_CONFLICT:
    'Câu hỏi vi phạm ràng buộc dữ liệu. Kiểm tra lại các trường liên kết.',
  QUESTION_CONCURRENT_UPDATE:
    'Có người vừa cập nhật câu hỏi này. Tải lại trang rồi thử lại.',
  CONTENT_REVISION_INVALID: 'Bản sửa không hợp lệ. Tải lại trang rồi thử lại.',
};

const QUESTION_CONFLICT_FALLBACK =
  'Thao tác xung đột với dữ liệu hiện tại. Tải lại trang rồi thử lại.';

export function questionConflictMessage(
  code: string | null | undefined,
): string {
  if (!code) return QUESTION_CONFLICT_FALLBACK;
  return QUESTION_CONFLICT_MESSAGE[code] ?? QUESTION_CONFLICT_FALLBACK;
}

const QUESTION_VALIDATION_EXTRA: Record<string, string> = {
  invalid_question_type: 'Loại câu hỏi không hợp lệ.',
  invalid_skill: 'Kỹ năng không hợp lệ.',
  invalid_difficulty: 'Độ khó phải là 1, 2 hoặc 3.',
  invalid_tag: 'Tên chủ đề không hợp lệ.',
  duplicate_tag: 'Hai chủ đề trùng nhau sau khi bỏ dấu và chuẩn hoá.',
};

export const QUESTION_VALIDATION_FALLBACK =
  'Dữ liệu câu hỏi không hợp lệ. Kiểm tra lại các ô được đánh dấu.';

/** Mã validator dùng chung với bài tập + mã riêng của ngân hàng câu hỏi. */
export function questionValidationMessage(
  code: string | null | undefined,
): string {
  if (!code) return QUESTION_VALIDATION_FALLBACK;
  const normalized = code.toLowerCase();
  for (const [key, message] of Object.entries({
    ...EXERCISE_VALIDATION_MESSAGE,
    ...QUESTION_VALIDATION_EXTRA,
  })) {
    if (key.toLowerCase() === normalized) return message;
  }
  return QUESTION_VALIDATION_FALLBACK;
}

/** Câu lỗi hiển thị ở vùng live/alert cho mọi response lỗi của câu hỏi. */
export function questionErrorMessage(
  status: number,
  code: string | null | undefined,
): string {
  if (status === 409) return questionConflictMessage(code);
  if (status === 422) return questionValidationMessage(code);
  if (status === 401) return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.';
  if (status === 403) return 'Bạn không có quyền thực hiện thao tác này.';
  if (status === 400) return 'Dữ liệu gửi lên không hợp lệ.';
  return 'Thao tác tạm thời không khả dụng. Hãy thử lại.';
}

/**
 * TL-31: nhãn lỗi import. Mã lạ trả câu chung kèm mã gốc để UI hiện trong
 * `<code>`; mã đã biết trả `unknownCode: null`.
 */
export function exerciseImportErrorLabel(code: string | null | undefined): {
  message: string;
  unknownCode: string | null;
} {
  if (!code)
    return { message: EXERCISE_VALIDATION_FALLBACK, unknownCode: null };
  const message = exerciseValidationMessage(code);
  return {
    message,
    unknownCode: message === EXERCISE_VALIDATION_FALLBACK ? code : null,
  };
}

/**
 * TL-41 (M5.2a): nhãn tiếng Việt cho mọi mã lỗi tải media (media-file.processor,
 * media-ingestion.service, guard, boundary interceptor, filter, BFF). Mã lạ →
 * câu chung, UI hiện mã gốc trong `<code>`.
 */
const MEDIA_UPLOAD_ERROR_MESSAGE: Record<string, string> = {
  FILE_REQUIRED: 'Chưa có tệp trong yêu cầu tải lên.',
  FILE_EMPTY: 'Tệp rỗng. Chọn tệp có nội dung.',
  FILE_SIZE_INVALID: 'Dung lượng tệp không hợp lệ.',
  FILE_MALFORMED: 'Tệp bị hỏng hoặc không đọc được.',
  MEDIA_TYPE_NOT_ALLOWED:
    'Loại tệp không được phép. Chỉ nhận JPG, PNG, MP3 hoặc WAV.',
  MIME_SIGNATURE_MISMATCH:
    'Nội dung tệp không khớp với loại tệp. Kiểm tra lại tệp hoặc đuôi tệp.',
  FILENAME_EXTENSION_MISMATCH:
    'Đuôi tên tệp không khớp với nội dung tệp. Tên tệp chỉ có một dấu chấm, ví dụ bai1.wav.',
  IMAGE_DIMENSIONS_EXCEEDED: 'Ảnh có kích thước quá lớn.',
  POLYGLOT_DETECTED: 'Tệp chứa nội dung lạ và bị từ chối.',
  MALWARE_DETECTED: 'Tệp bị quét phát hiện mã độc và đã bị từ chối.',
  MEDIA_REJECTED: 'Tệp đã bị từ chối khi kiểm tra.',
  MEDIA_SOURCE_NOT_APPROVED:
    'Nguồn dữ liệu này chưa đủ giấy phép để nhận media. Chọn nguồn khác.',
  MEDIA_CLEANUP_REQUIRED:
    'Lần tải trước cần được dọn dẹp trước khi thử lại. Liên hệ quản trị hệ thống.',
  MEDIA_CLEANUP_OUTCOME_UNKNOWN:
    'Chưa rõ kết quả dọn dẹp lần tải trước. Thử lại sau ít phút.',
  MEDIA_FINALIZE_OUTCOME_UNKNOWN:
    'Chưa rõ kết quả lưu tệp. Thử lại sau ít phút với cùng tệp.',
  MEDIA_REJECTION_OUTCOME_UNKNOWN:
    'Chưa rõ kết quả kiểm tra tệp. Thử lại sau ít phút với cùng tệp.',
  MEDIA_DATABASE_UNAVAILABLE: 'Cơ sở dữ liệu tạm không phản hồi. Thử lại sau.',
  MEDIA_PROCESSING_UNAVAILABLE:
    'Dịch vụ xử lý media tạm không phản hồi. Thử lại sau.',
  MEDIA_INGESTION_UNAVAILABLE:
    'Dịch vụ tải media tạm không phản hồi. Thử lại sau.',
  MEDIA_SCANNER_UNAVAILABLE:
    'Dịch vụ quét virus tạm không phản hồi. Thử lại sau.',
  MEDIA_SCANNER_INVALID_RESPONSE:
    'Dịch vụ quét virus trả kết quả không hợp lệ. Thử lại sau.',
  MEDIA_STORAGE_UNAVAILABLE:
    'Kho lưu trữ media tạm không phản hồi. Thử lại sau.',
  MEDIA_STORAGE_INTEGRITY_ERROR:
    'Tệp đã lưu không khớp kiểm tra toàn vẹn. Liên hệ quản trị hệ thống.',
  MEDIA_STORAGE_PROVIDER_MISMATCH:
    'Kho lưu trữ của lần tải này khác cấu hình hiện tại. Liên hệ quản trị hệ thống.',
  IDEMPOTENCY_KEY_IN_USE:
    'Mã tải lên đã được dùng cho tệp khác. Bấm "Tải lên" để thử lại với mã mới.',
  IDEMPOTENCY_KEY_RENEWAL_REQUIRED:
    'Lần tải trước đã được dọn dẹp. Bấm "Tải lên" để thử lại với mã mới.',
  MEDIA_INGESTION_IN_PROGRESS:
    'Tệp này đang được xử lý. Đợi một lát rồi bấm "Tải lên" lại.',
  MEDIA_INGESTION_BUSY:
    'Hệ thống đang bận xử lý tệp khác. Thử lại sau vài giây.',
  MEDIA_INGESTION_DISABLED: 'Tính năng tải media đang tạm tắt.',
  MEDIA_UPLOAD_TIMEOUT: 'Tải lên quá thời gian cho phép. Thử lại.',
  MEDIA_UPLOAD_ABORTED: 'Kết nối bị ngắt khi đang tải lên. Thử lại.',
  MEDIA_UPLOAD_BFF_TIMEOUT:
    'Máy chủ chưa phản hồi kịp. Bấm "Tải lên" để thử lại với cùng tệp.',
  UPLOAD_TOO_LARGE: 'Tệp vượt quá 10 MB.',
  UPLOAD_BODY_INCOMPLETE: 'Tệp gửi lên không đầy đủ. Thử lại.',
  MULTIPART_INVALID: 'Yêu cầu tải lên không hợp lệ. Chọn lại tệp rồi thử lại.',
  INVALID_IDEMPOTENCY_KEY: 'Thiếu mã tải lên. Chọn lại tệp rồi thử lại.',
  TOO_MANY_REQUESTS:
    'Bạn đã tải lên quá nhiều trong một phút. Thử lại sau khoảng 1 phút.',
  BAD_REQUEST: 'Yêu cầu tải lên không hợp lệ.',
  CONFLICT: 'Tệp đang bị xung đột với lần tải khác. Thử lại.',
};

export const MEDIA_UPLOAD_ERROR_FALLBACK =
  'Không tải được tệp. Thử lại hoặc liên hệ quản trị hệ thống.';

export function mediaUploadErrorLabel(code: string | null | undefined): {
  message: string;
  unknownCode: string | null;
} {
  const message = code ? MEDIA_UPLOAD_ERROR_MESSAGE[code] : undefined;
  if (message) return { message, unknownCode: null };
  return { message: MEDIA_UPLOAD_ERROR_FALLBACK, unknownCode: code ?? null };
}

/* M5.2b (TL-51): lượt tải cần xử lý — trạng thái, mã lỗi, tông badge. */
const MEDIA_INGESTION_STATUS: Record<string, string> = {
  cleanup_required: 'Cần dọn dẹp',
  processing: 'Kẹt xử lý',
};

const MEDIA_INGESTION_TONE: Record<string, AdminBadgeTone> = {
  cleanup_required: 'draft',
  processing: 'danger',
};

const MEDIA_INGESTION_FAILURE: Record<string, string> = {
  OBJECT_WRITE_OUTCOME_UNKNOWN: 'Không rõ kết quả ghi tệp',
  OBJECT_CLEANUP_REQUIRED: 'Lần dọn trước bị lỗi',
  OBJECT_CLEANUP_SETTLING: 'Đang chờ xác nhận tệp đã xoá',
  OBJECT_CLEANUP_IN_PROGRESS: 'Đang dọn dẹp',
};

export function mediaIngestionStatusLabel(status: string): string {
  return MEDIA_INGESTION_STATUS[status] ?? status;
}

export function mediaIngestionStatusTone(status: string): AdminBadgeTone {
  return MEDIA_INGESTION_TONE[status] ?? 'muted';
}

/** Nhãn mã lỗi; `null` khi mã lạ (UI hiện mã thô dạng mono). */
export function mediaIngestionFailureLabel(code: string): string | null {
  return MEDIA_INGESTION_FAILURE[code] ?? null;
}

/** TL-52: câu kết quả nút Dọn dẹp, theo status và mã lỗi của BFF. */
export function mediaCleanupResultLabel(
  ingestionId: number,
  result:
    | { kind: 'completed' }
    | { kind: 'settling' }
    | { kind: 'error'; status: number; code: string | null },
): string {
  if (result.kind === 'completed') return `Đã dọn dẹp bản ghi #${ingestionId}.`;
  if (result.kind === 'settling') {
    return `Bản ghi #${ingestionId}: tệp không còn trong storage. Bấm Dọn dẹp lại sau ít nhất 1 phút để hoàn tất.`;
  }
  if (result.status === 409) {
    return `Bản ghi #${ingestionId} đã thay đổi hoặc đang được dọn. Danh sách đã được làm mới.`;
  }
  if (result.status === 503 && result.code === 'MEDIA_CLEANUP_REQUIRED') {
    return 'Storage tạm thời không dọn được. Thử lại sau.';
  }
  if (
    result.status === 503 &&
    result.code === 'MEDIA_CLEANUP_OUTCOME_UNKNOWN'
  ) {
    return 'Chưa rõ kết quả dọn dẹp. Làm mới trang để xem trạng thái.';
  }
  return 'Không dọn dẹp được. Thử lại sau.';
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

export function questionTypeLabel(type: string): string {
  return QUESTION_TYPE[type] ?? type;
}

export function skillLabel(skill: string): string {
  return SKILL[skill] ?? skill;
}

export function questionStatusLabel(status: string): string {
  return QUESTION_STATUS[status] ?? status;
}

export function difficultyLabel(value: number | null): string {
  if (value === null) return '—';
  return DIFFICULTY[String(value)] ?? '—';
}

/**
 * TL-90: nhãn tiếng Việt của `changedFields` trong lịch sử phiên bản.
 */
const QUESTION_CHANGED_FIELD: Record<string, string> = {
  type: 'Loại câu hỏi',
  skill: 'Kỹ năng',
  levelId: 'Cấp độ',
  content: 'Nội dung',
  answers: 'Đáp án',
  correctAnswer: 'Đáp án đúng',
  explanation: 'Giải thích',
  objective: 'Mục tiêu',
  difficulty: 'Độ khó',
  audioId: 'Audio',
  imageId: 'Ảnh',
  tags: 'Chủ đề',
};

export function questionChangedFieldLabel(field: string): string {
  return QUESTION_CHANGED_FIELD[field] ?? field;
}

/** TL-91: lý do publish bị chặn (`QUESTION_NOT_PUBLISHABLE.details.reasons`). */
const QUESTION_PUBLISH_REASON: Record<string, string> = {
  explanation_required: 'Thiếu giải thích.',
  audio_required: 'Kỹ năng Nghe cần có audio.',
  audio_not_ready: 'Audio chưa sẵn sàng.',
  image_not_ready: 'Ảnh chưa sẵn sàng.',
  level_not_found: 'Cấp độ không tồn tại.',
};

export function questionPublishReasonLabel(code: string): string {
  return (
    QUESTION_PUBLISH_REASON[code] ?? `Chưa đủ điều kiện xuất bản (${code}).`
  );
}

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
