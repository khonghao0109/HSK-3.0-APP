'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { useRouter } from 'next/navigation';

import { exerciseImportErrorLabel } from '@/features/admin-shell/admin-labels';

import {
  exerciseImportFileMessage,
  isExerciseImportFileName,
  parseExerciseImportFile,
} from './exercise-import-file';
import {
  EXERCISE_IMPORT_MAX_BYTES,
  EXERCISE_IMPORT_MAX_DISPLAYED_ERRORS,
  IMPORT_STEPS,
  IMPORT_TEXT,
  formatImportBytes,
  type ExerciseImportDataSource,
  type ExerciseImportPreview,
  type ExerciseImportResult,
  type ExerciseImportRowError,
} from './exercise-import-values';

type SelectedFile = { name: string; size: number; rows: unknown[] };
type Pending = 'preview' | 'commit' | null;
type ImportFailure = { message: string; errors: ExerciseImportRowError[] };
type Step = 1 | 2 | 3;

const PREVIEW_URL = '/api/admin/exercise-imports/preview';
const COMMIT_URL = '/api/admin/exercise-imports';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readRowErrors(value: unknown): ExerciseImportRowError[] {
  if (!Array.isArray(value)) return [];
  const errors: ExerciseImportRowError[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const rowNumber = asNumber(item.rowNumber);
    const { code, path } = item;
    if (
      rowNumber === null ||
      typeof code !== 'string' ||
      typeof path !== 'string'
    )
      continue;
    errors.push({ rowNumber, code, path });
  }
  return errors;
}

function readPreview(value: unknown): ExerciseImportPreview | null {
  if (!isRecord(value) || value.success !== true || !isRecord(value.data))
    return null;
  const data = value.data;
  const totalRows = asNumber(data.totalRows);
  const validRows = asNumber(data.validRows);
  const invalidRows = asNumber(data.invalidRows);
  const previewHash = data.previewHash;
  if (
    totalRows === null ||
    validRows === null ||
    invalidRows === null ||
    typeof previewHash !== 'string' ||
    previewHash.length === 0
  ) {
    return null;
  }
  const errors = readRowErrors(data.errors);
  const errorsTotal = asNumber(data.errorsTotal);
  return {
    totalRows,
    validRows,
    invalidRows,
    errors,
    // Z1: BFF luôn gửi errorsTotal; fallback cho phản hồi cũ/giả lập.
    errorsTotal: errorsTotal ?? errors.length,
    previewHash,
  };
}

function readCommitResult(value: unknown): ExerciseImportResult | null {
  if (!isRecord(value) || value.success !== true || !isRecord(value.data))
    return null;
  const importedRows = asNumber(value.data.importedRows);
  const exercises = value.data.exercises;
  if (importedRows === null || !Array.isArray(exercises)) return null;
  const exerciseIds: number[] = [];
  for (const item of exercises) {
    if (!isRecord(item)) return null;
    const id = asNumber(item.id);
    if (id === null) return null;
    exerciseIds.push(id);
  }
  return { importedRows, exerciseIds };
}

function readFailure(value: unknown): {
  code: string | null;
  errors: ExerciseImportRowError[];
} {
  if (!isRecord(value) || value.success !== false || !isRecord(value.error))
    return { code: null, errors: [] };
  const code = typeof value.error.code === 'string' ? value.error.code : null;
  const details = value.error.details;
  return {
    code,
    errors: isRecord(details) ? readRowErrors(details.errors) : [],
  };
}

async function postJson(
  url: string,
  body: unknown,
  idempotencyKey?: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(idempotencyKey === undefined
        ? {}
        : { 'idempotency-key': idempotencyKey }),
    },
    body: JSON.stringify(body),
  });
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed };
}

/**
 * TL-27: mỗi lần preview thành công tạo một key bằng `crypto.randomUUID()`;
 * commit lỗi mạng/503 thử lại đúng key đó.
 */
function createIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

function failureMessage(status: number, code: string | null): string {
  // Z11: 413 (BFF hoặc backend) luôn là câu kích thước tệp.
  if (status === 413) return IMPORT_TEXT.oversize;
  if (status === 409 || status === 422) return IMPORT_TEXT.stale;
  if (status >= 500) return IMPORT_TEXT.serverError;
  if (code === 'MALFORMED_REQUEST') return 'Tệp JSON không hợp lệ.';
  return 'Không kiểm tra được tệp. Kiểm tra lại tệp rồi thử lại.';
}

/**
 * M5.1b2 (TL-25, TL-27–TL-33; Z1–Z8, Z11, Z13) — màn nhập bài tập JSON.
 * Client chỉ kiểm cấu trúc tệp; nội dung từng bài do backend preview kiểm.
 * Đổi tệp/nguồn sau khi preview xoá preview + key (TL-28); khi đang chờ thì
 * khoá UI và phản hồi của request cũ bị bỏ qua (Z2).
 */
export function ExerciseImportScreen({
  dataSources,
}: {
  dataSources: ExerciseImportDataSource[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  // Z2: chốt phiên — mỗi lần preview/commit lấy một requestId; đổi tệp/nguồn
  // tăng bộ đếm nên phản hồi cũ về sau bị bỏ qua.
  const requestIdRef = useRef(0);
  // Z3: lần chọn tệp sau thắng nếu lần đọc tệp trước về muộn.
  const fileReadSeqRef = useRef(0);
  const [dataSourceId, setDataSourceId] = useState('');
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ExerciseImportPreview | null>(null);
  const [previewHash, setPreviewHash] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [result, setResult] = useState<ExerciseImportResult | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [isOver, setIsOver] = useState(false);
  const [step, setStep] = useState<Step>(1);

  const noSources = dataSources.length === 0;
  // Z2: khi đang chờ preview/commit thì khoá nguồn, tệp và vùng thả.
  const locked = noSources || pending !== null;

  useEffect(() => {
    if (result) resultHeadingRef.current?.focus();
  }, [result]);

  function invalidatePending() {
    requestIdRef.current += 1;
    setPending(null);
  }

  function resetPreview() {
    setPreview(null);
    setPreviewHash(null);
    setIdempotencyKey(null);
    setFailure(null);
    setStep(1);
  }

  function clearFileInput() {
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function acceptFile(nextFile: File) {
    invalidatePending();
    const readId = ++fileReadSeqRef.current;
    resetPreview();
    setResult(null);
    setStep(1);
    if (!isExerciseImportFileName(nextFile.name)) {
      setFile(null);
      setFileError(exerciseImportFileMessage({ reason: 'not_json_extension' }));
      return;
    }
    // Z3: kiểm kích thước TRƯỚC khi đọc nội dung tệp.
    if (nextFile.size > EXERCISE_IMPORT_MAX_BYTES) {
      setFile(null);
      setFileError(IMPORT_TEXT.oversize);
      return;
    }
    // W2: chưa có tệp hiện hành trong lúc đang đọc → không thể preview tệp cũ.
    setFile(null);
    setFileError(null);
    let text: string;
    try {
      text = await nextFile.text();
    } catch {
      if (readId !== fileReadSeqRef.current) return;
      setFile(null);
      setFileError(IMPORT_TEXT.fileReadError);
      return;
    }
    // Z3: lần chọn sau thắng — bỏ kết quả của lần đọc cũ.
    if (readId !== fileReadSeqRef.current) return;
    const parsed = parseExerciseImportFile(text, nextFile.size);
    if (!parsed.ok) {
      setFile(null);
      setFileError(exerciseImportFileMessage(parsed));
      return;
    }
    setFile({ name: nextFile.name, size: nextFile.size, rows: parsed.rows });
    setFileError(null);
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0];
    // W2: xoá value để chọn lại đúng tệp vẫn phát sự kiện change.
    clearFileInput();
    if (nextFile) await acceptFile(nextFile);
  }

  async function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsOver(false);
    if (locked) return;
    const nextFile = event.dataTransfer.files?.[0];
    if (nextFile) await acceptFile(nextFile);
  }

  function onSourceChange(event: ChangeEvent<HTMLSelectElement>) {
    invalidatePending();
    setDataSourceId(event.target.value);
    setResult(null);
    resetPreview();
  }

  async function onPreview() {
    if (noSources || file === null || dataSourceId === '' || pending !== null) {
      return;
    }
    const requestId = ++requestIdRef.current;
    setPending('preview');
    setFailure(null);
    try {
      const { status, body } = await postJson(PREVIEW_URL, {
        dataSourceId: Number(dataSourceId),
        fileName: file.name,
        rows: file.rows,
      });
      if (requestId !== requestIdRef.current) return;
      if (status === 401) {
        router.push('/login');
        return;
      }
      if (status === 403) {
        router.push('/forbidden');
        return;
      }
      const parsed = readPreview(body);
      if (status >= 200 && status < 300 && parsed) {
        setPreview(parsed);
        setPreviewHash(parsed.previewHash);
        setIdempotencyKey(createIdempotencyKey());
        setStep(2);
        return;
      }
      const failed = readFailure(body);
      setPreview(null);
      setPreviewHash(null);
      setIdempotencyKey(null);
      setFailure({
        message: failureMessage(status, failed.code),
        errors: failed.errors,
      });
    } catch {
      if (requestId === requestIdRef.current) {
        setFailure({ message: IMPORT_TEXT.serverError, errors: [] });
      }
    } finally {
      if (requestId === requestIdRef.current) setPending(null);
    }
  }

  async function onCommit() {
    if (
      noSources ||
      file === null ||
      dataSourceId === '' ||
      previewHash === null ||
      idempotencyKey === null ||
      pending !== null
    ) {
      return;
    }
    const requestId = ++requestIdRef.current;
    setPending('commit');
    setFailure(null);
    try {
      const { status, body } = await postJson(
        COMMIT_URL,
        {
          dataSourceId: Number(dataSourceId),
          fileName: file.name,
          rows: file.rows,
          previewHash,
        },
        idempotencyKey,
      );
      if (requestId !== requestIdRef.current) return;
      if (status === 401) {
        router.push('/login');
        return;
      }
      if (status === 403) {
        router.push('/forbidden');
        return;
      }
      const imported = readCommitResult(body);
      if (status >= 200 && status < 300 && imported) {
        setResult(imported);
        setPreview(null);
        setPreviewHash(null);
        setIdempotencyKey(null);
        setFailure(null);
        setStep(3);
        return;
      }
      const failed = readFailure(body);
      if (status === 422 && failed.code === 'IMPORT_VALIDATION_FAILED') {
        // W3: backend có thể đã cắt còn 100 lỗi, nên KHÔNG suy ra
        // Tổng/Hợp lệ/Lỗi; chỉ hiện bảng lỗi + câu xem trước lại.
        setPreview(null);
        setPreviewHash(null);
        setIdempotencyKey(null);
        setFailure({ message: IMPORT_TEXT.stale, errors: failed.errors });
        setStep(2);
        return;
      }
      if (status === 409) {
        setPreviewHash(null);
        setIdempotencyKey(null);
        setFailure({ message: IMPORT_TEXT.stale, errors: [] });
        setStep(2);
        return;
      }
      if (status >= 500) {
        // Giữ key: TL-27 cho phép thử lại commit với đúng key này.
        setFailure({ message: IMPORT_TEXT.serverError, errors: [] });
        return;
      }
      setFailure({
        message: failureMessage(status, failed.code),
        errors: failed.errors,
      });
      setStep(2);
    } catch {
      if (requestId === requestIdRef.current) {
        setFailure({ message: IMPORT_TEXT.serverError, errors: [] });
      }
    } finally {
      if (requestId === requestIdRef.current) setPending(null);
    }
  }

  /** Z4: sau khi nhập xong, "Nhập tệp khác" xoá tệp/preview/key/kết quả, giữ nguồn. */
  function resetForAnotherFile() {
    invalidatePending();
    fileReadSeqRef.current += 1;
    setFile(null);
    setFileError(null);
    resetPreview();
    setResult(null);
    setStep(1);
    clearFileInput();
  }

  const previewing = pending === 'preview';
  const committing = pending === 'commit';
  const canPreview =
    !noSources && dataSourceId !== '' && file !== null && pending === null;
  const canCommit =
    !noSources &&
    file !== null &&
    preview !== null &&
    preview.invalidRows === 0 &&
    previewHash !== null &&
    idempotencyKey !== null &&
    pending === null &&
    result === null;

  const errors =
    failure && failure.errors.length > 0
      ? failure.errors
      : (preview?.errors ?? []);
  const errorsTotal = preview?.errorsTotal ?? errors.length;
  const showErrorsLimitNote =
    errors.length > 0 && errorsTotal > EXERCISE_IMPORT_MAX_DISPLAYED_ERRORS;

  // Z7: mỗi nút tắt có đúng MỘT câu lý do, nối bằng aria-describedby.
  const showPreviewHint = !canPreview && pending === null && result === null;
  const showCommitHint =
    !canCommit && pending === null && result === null && !noSources;
  const previewHintText = noSources
    ? IMPORT_TEXT.sourceEmptyShort
    : IMPORT_TEXT.previewHint;
  // W4: chỉ gắn aria-describedby khi phần tử câu lý do thật sự có trong DOM.
  const commitDescribedBy = canCommit
    ? undefined
    : noSources
      ? showPreviewHint
        ? 'import-preview-hint'
        : undefined
      : showCommitHint
        ? 'import-commit-hint'
        : undefined;
  const sourceDescribedBy = [
    'import-source-help',
    ...(noSources ? ['import-sources-empty'] : []),
  ].join(' ');

  return (
    <div className="adm-page-stack adm-import-page">
      <header className="adm-page-head">
        <div>
          <h1>{IMPORT_TEXT.heading}</h1>
          <p>{IMPORT_TEXT.intro}</p>
        </div>
      </header>

      <ol className="adm-import-steps" aria-label="Các bước nhập dữ liệu">
        {IMPORT_STEPS.map((label, index) => {
          const number = (index + 1) as Step;
          return (
            <li
              className="adm-import-steps__item"
              key={label}
              aria-current={step === number ? 'step' : undefined}
            >
              <span className="adm-import-steps__num" aria-hidden="true">
                {number}
              </span>
              {label}
            </li>
          );
        })}
      </ol>

      {noSources ? (
        <p
          className="adm-card adm-panel adm-import-error"
          role="note"
          id="import-sources-empty"
        >
          {IMPORT_TEXT.sourceEmpty}
        </p>
      ) : null}

      <section
        className="adm-card adm-panel"
        aria-labelledby="import-file-heading"
      >
        <h2 id="import-file-heading">{IMPORT_STEPS[0]}</h2>
        <div className="adm-import-field">
          <label className="adm-import-field__label" htmlFor="import-source">
            {`${IMPORT_TEXT.sourceLabel} *`}
          </label>
          <select
            className="adm-import-select"
            id="import-source"
            value={dataSourceId}
            onChange={onSourceChange}
            disabled={locked}
            aria-describedby={sourceDescribedBy}
          >
            <option value="">{IMPORT_TEXT.sourcePlaceholder}</option>
            {dataSources.map((source) => (
              <option key={source.id} value={String(source.id)}>
                {`${source.name} · ${source.code} · ${source.version}`}
              </option>
            ))}
          </select>
          <p className="adm-import-help" id="import-source-help">
            {IMPORT_TEXT.sourceHelp}
          </p>
        </div>

        <div
          className={`adm-import-drop${isOver ? ' is-over' : ''}`}
          aria-disabled={locked ? 'true' : undefined}
          onDragOver={(event) => {
            event.preventDefault();
            if (!locked) setIsOver(true);
          }}
          onDragLeave={() => setIsOver(false)}
          onDrop={onDrop}
        >
          <label className="adm-import-drop__label" htmlFor="import-file">
            {IMPORT_TEXT.dropHint}
          </label>
          <input
            className="sr-only"
            id="import-file"
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            tabIndex={-1}
            onChange={onFileChange}
            disabled={locked}
            aria-describedby="import-file-help import-file-error"
          />
          <div className="adm-import-file">
            {file ? (
              <span className="adm-import-file__name">
                {file.name} ·{' '}
                {/* W6: số và đơn vị dung lượng không bị ngắt dòng. */}
                <span className="adm-import-file__size">
                  {formatImportBytes(file.size)}
                </span>{' '}
                · {file.rows.length} dòng
              </span>
            ) : null}
            {/* Z13: đã có tệp chỉ hiện "Chọn tệp khác". */}
            <button
              className="adm-btn"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={locked}
            >
              {file ? IMPORT_TEXT.chooseAnotherFile : IMPORT_TEXT.chooseFile}
            </button>
          </div>
          <p className="adm-import-help" id="import-file-help">
            {IMPORT_TEXT.fileHelp}
          </p>
          {fileError ? (
            <p className="adm-import-error" id="import-file-error" role="alert">
              {fileError}
            </p>
          ) : (
            <span id="import-file-error" />
          )}
        </div>

        <div className="adm-import-footer">
          <button
            className="adm-btn adm-btn--primary"
            type="button"
            onClick={onPreview}
            disabled={!canPreview}
            aria-describedby={
              showPreviewHint ? 'import-preview-hint' : undefined
            }
          >
            {previewing ? IMPORT_TEXT.previewing : IMPORT_TEXT.preview}
          </button>
        </div>
        {showPreviewHint ? (
          <p className="adm-import-hint" id="import-preview-hint">
            {previewHintText}
          </p>
        ) : null}
      </section>

      {/* Z5: live region chỉ bọc thông báo ngắn (lỗi), không bọc bảng/thẻ. */}
      {failure ? (
        <div aria-live="polite">
          <p className="adm-card adm-panel adm-import-error" role="alert">
            {failure.message}
          </p>
        </div>
      ) : null}

      {preview ? (
        <section
          className="adm-card adm-panel"
          aria-labelledby="import-preview-heading"
        >
          <h2 id="import-preview-heading">{IMPORT_TEXT.previewCard}</h2>
          <dl className="adm-import-stats">
            <div className="adm-import-stats__item">
              <dt>{IMPORT_TEXT.totalRows}</dt>
              <dd>{preview.totalRows}</dd>
            </div>
            <div className="adm-import-stats__item">
              <dt>{IMPORT_TEXT.validRows}</dt>
              <dd>{preview.validRows}</dd>
            </div>
            <div className="adm-import-stats__item adm-import-stats__item--error">
              <dt>{IMPORT_TEXT.errorRows}</dt>
              <dd>{preview.invalidRows}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {errors.length > 0 ? (
        <section
          className="adm-card adm-panel"
          aria-labelledby="import-errors-heading"
        >
          <h2 id="import-errors-heading">{IMPORT_TEXT.errorTable}</h2>
          <div
            className="adm-import-scroll"
            tabIndex={0}
            role="region"
            aria-label={IMPORT_TEXT.errorScrollLabel}
          >
            <table className="adm-import-table">
              <caption className="sr-only">{IMPORT_TEXT.errorTable}</caption>
              <thead>
                <tr>
                  <th scope="col">{IMPORT_TEXT.columnRow}</th>
                  <th scope="col">{IMPORT_TEXT.columnField}</th>
                  <th scope="col">{IMPORT_TEXT.columnError}</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((error, index) => {
                  const label = exerciseImportErrorLabel(error.code);
                  return (
                    <tr key={`${error.rowNumber}-${error.path}-${index}`}>
                      <td>{error.rowNumber}</td>
                      <td>
                        <code>{error.path}</code>
                      </td>
                      <td>
                        {label.message}
                        {label.unknownCode ? (
                          <>
                            {' '}
                            (<code>{label.unknownCode}</code>)
                          </>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {showErrorsLimitNote ? (
            <p className="adm-import-hint" id="import-errors-limit">
              {IMPORT_TEXT.errorsLimit(errorsTotal)}
            </p>
          ) : null}
          {failure &&
          failure.errors.length === EXERCISE_IMPORT_MAX_DISPLAYED_ERRORS ? (
            <p className="adm-import-hint" id="import-errors-truncated">
              {IMPORT_TEXT.errorsTruncated}
            </p>
          ) : null}
        </section>
      ) : null}

      {result ? (
        <section
          className="adm-card adm-panel adm-import-success"
          aria-labelledby="import-result-heading"
        >
          <h2 id="import-result-heading" ref={resultHeadingRef} tabIndex={-1}>
            {IMPORT_TEXT.successHeading}
          </h2>
          <div aria-live="polite">
            <p role="status">
              {IMPORT_TEXT.successStatus(result.importedRows)}
            </p>
          </div>
          <h3>{IMPORT_TEXT.successLinks}</h3>
          <ul>
            {result.exerciseIds.map((exerciseId) => (
              <li key={exerciseId}>
                <a href={`/admin/exercises/${exerciseId}`}>
                  {`Bài tập #${exerciseId}`}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="adm-import-footer">
        <button
          className="adm-btn"
          type="button"
          onClick={result ? resetForAnotherFile : resetPreview}
          disabled={(!result && step === 1) || pending !== null}
        >
          {result ? IMPORT_TEXT.newFile : IMPORT_TEXT.back}
        </button>
        <button
          className="adm-btn adm-btn--primary"
          type="button"
          onClick={onCommit}
          disabled={!canCommit}
          aria-describedby={commitDescribedBy}
        >
          {committing ? IMPORT_TEXT.committing : IMPORT_TEXT.commit}
        </button>
      </div>
      {showCommitHint ? (
        <p className="adm-import-hint" id="import-commit-hint">
          {IMPORT_TEXT.commitHint}
        </p>
      ) : null}
    </div>
  );
}
