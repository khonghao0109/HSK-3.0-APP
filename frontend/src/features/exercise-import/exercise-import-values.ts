/**
 * M5.1b2 — hằng số và type thuần (không import gì, không Zod) dùng chung cho
 * module parse tệp, route BFF và màn nhập. Zod nằm ở exercise-import-contract.ts
 * (server-only) để client component không kéo Zod vào bundle (client-bundle-guard).
 */

/** TL-30: client chặn > 90 000 byte; backend vẫn giữ giới hạn JSON 100 KB. */
export const EXERCISE_IMPORT_MAX_BYTES = 90_000;
export const EXERCISE_IMPORT_MAX_ROWS = 100;
/** TL-30: BFF chặn body > 102 400 byte trước khi parse (413). */
export const EXERCISE_IMPORT_BFF_MAX_BYTES = 102_400;
/** Z1: BFF chỉ trả 100 lỗi đầu, kèm `errorsTotal` là số lỗi thật. */
export const EXERCISE_IMPORT_MAX_DISPLAYED_ERRORS = 100;

export type ExerciseImportDataSource = {
  id: number;
  code: string;
  name: string;
  version: string;
};

export type ExerciseImportRowError = {
  rowNumber: number;
  code: string;
  path: string;
};

export type ExerciseImportPreview = {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: ExerciseImportRowError[];
  /** Z1: tổng số lỗi backend báo (có thể > 100); `errors` chỉ chứa 100 lỗi đầu. */
  errorsTotal: number;
  previewHash: string;
};

export type ExerciseImportResult = {
  importedRows: number;
  exerciseIds: number[];
};

export const IMPORT_STEPS = [
  'Tải dữ liệu',
  'Xem trước & kiểm tra',
  'Nhập dữ liệu',
] as const;

/** TL-29/TL-32/TL-33/Q101: câu chữ cố định của màn nhập. */
export const IMPORT_TEXT = {
  heading: 'Nhập dữ liệu',
  intro:
    'Nhập bài tập từ tệp JSON theo định dạng nhập v1. Bài nhập vào ở trạng thái Bản nháp.',
  sourceLabel: 'Nguồn dữ liệu',
  sourcePlaceholder: 'Chọn nguồn dữ liệu',
  /** Q101: hiện mọi nguồn (kể cả 8 nguồn từ điển của migration), không lọc. */
  sourceHelp:
    'Chọn đúng nguồn biên soạn của bài tập; nguồn mới do quản trị hệ thống thêm.',
  sourceEmpty:
    'Chưa có nguồn dữ liệu. Liên hệ quản trị hệ thống để thêm nguồn.',
  /** Z7: câu lý do ngắn cho nút tắt khi danh sách nguồn rỗng. */
  sourceEmptyShort: 'Chưa có nguồn dữ liệu.',
  previewHint: 'Chọn nguồn dữ liệu và tệp .json để xem trước.',
  commitHint: 'Cần xem trước không có lỗi trước khi nhập.',
  chooseFile: 'Chọn tệp',
  chooseAnotherFile: 'Chọn tệp khác',
  newFile: 'Nhập tệp khác',
  dropHint: 'Kéo thả tệp .json vào đây',
  fileHelp:
    'Tệp .json là một mảng bài tập theo định dạng nhập v1 (tối đa 100 dòng, 90 KB). Bài nhập vào ở trạng thái Bản nháp.',
  oversize: 'Tệp tối đa 90 KB.',
  fileReadError: 'Không đọc được tệp. Chọn lại tệp.',
  preview: 'Xem trước & kiểm tra',
  previewing: 'Đang kiểm tra…',
  previewCard: 'Kết quả kiểm tra',
  totalRows: 'Tổng dòng',
  validRows: 'Hợp lệ',
  errorRows: 'Lỗi',
  errorTable: 'Danh sách lỗi',
  columnRow: 'Dòng',
  columnField: 'Trường',
  columnError: 'Lỗi',
  errorScrollLabel: 'Vùng cuộn danh sách lỗi',
  back: 'Quay lại',
  commit: 'Nhập dữ liệu',
  committing: 'Đang nhập…',
  stale: 'Dữ liệu đã thay đổi, hãy xem trước lại.',
  serverError: 'Không kết nối được máy chủ. Thử lại.',
  forbidden: 'Bạn không có quyền nhập dữ liệu.',
  successHeading: 'Đã nhập dữ liệu',
  successStatus: (count: number) =>
    `Đã nhập ${count} bài tập ở trạng thái Bản nháp.`,
  successLinks: 'Bài tập vừa nhập',
  errorsLimit: (total: number) =>
    `Hiện ${EXERCISE_IMPORT_MAX_DISPLAYED_ERRORS} lỗi đầu trong ${total} lỗi.`,
  /** W3: 422 lúc commit chỉ có danh sách đã cắt 100, không suy ra được tổng. */
  errorsTruncated: 'Hiện 100 lỗi đầu; xem trước lại để có đủ danh sách.',
} as const;

/** 90 000 byte → "87,9 KB" (dấu phẩy thập phân kiểu Việt Nam). */
export function formatImportBytes(bytes: number): string {
  const kb = bytes / 1024;
  return `${kb.toFixed(1).replace('.', ',')} KB`;
}
