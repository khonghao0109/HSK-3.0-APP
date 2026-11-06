'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
  mediaUploadErrorLabel,
  processingStatusLabel,
} from '@/features/admin-shell/admin-labels';
import { type ExerciseImportDataSource } from '@/features/exercise-import/exercise-import-values';

import {
  MEDIA_UPLOAD_ACCEPT,
  MEDIA_UPLOAD_TEXT,
  canonicalMediaFile,
  checkMediaFile,
} from './media-upload-values';
import { formatMediaBytes } from '@/features/media/media-format';

const UPLOAD_URL = '/api/admin/media/ingestions';
const SOURCE_NOT_APPROVED = 'MEDIA_SOURCE_NOT_APPROVED';
/** TL-38: các mã 409 buộc đổi key cho lần bấm sau. */
const RENEW_KEY_CODES = new Set([
  'IDEMPOTENCY_KEY_IN_USE',
  'IDEMPOTENCY_KEY_RENEWAL_REQUIRED',
]);

type Selected = { file: File; mimeType: string };
type Success = {
  id: number;
  filename: string;
  processingStatus: string;
  idempotent: boolean;
};
type Failure = { message: string; unknownCode: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function newKey(): string {
  return globalThis.crypto.randomUUID();
}

/** Hợp đồng 201 không có filename: tên lấy từ tệp đã chọn. */
function readSuccess(body: unknown, fallbackName: string): Success | null {
  if (!isRecord(body) || body.success !== true || !isRecord(body.data))
    return null;
  const media = body.data.media;
  if (!isRecord(media) || !Number.isInteger(media.id)) return null;
  if (typeof media.processingStatus !== 'string') return null;
  return {
    id: media.id as number,
    filename: fallbackName,
    processingStatus: media.processingStatus,
    idempotent: body.data.idempotent === true,
  };
}

function readCode(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.error)) return null;
  return typeof body.error.code === 'string' ? body.error.code : null;
}

/** Thông báo trang khi tính năng tắt — dùng chung cho nhánh "tắt". */
function BackLink() {
  return (
    <Link className="adm-btn adm-btn--ghost" href="/admin/media">
      Về thư viện media
    </Link>
  );
}

/**
 * M5.2a (TL-34, TL-38, TL-42) — màn tải media đồng bộ. Client chỉ chặn sớm tên/
 * dung lượng; backend là nguồn đúng. Key idempotency đổi khi đổi tệp/nguồn và
 * sau thành công; giữ nguyên để thử lại sau lỗi mạng/503/409 IN_PROGRESS.
 */
export function MediaUploadScreen({
  ingestionEnabled,
  dataSources,
}: {
  ingestionEnabled: boolean;
  dataSources: ExerciseImportDataSource[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chooseButtonRef = useRef<HTMLButtonElement>(null);
  const successHeadingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLSelectElement>(null);
  // Z2: phản hồi của request cũ bị bỏ khi requestId đã tăng.
  const requestIdRef = useRef(0);
  const [dataSourceId, setDataSourceId] = useState('');
  const [selected, setSelected] = useState<Selected | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [success, setSuccess] = useState<Success | null>(null);
  const [isOver, setIsOver] = useState(false);

  useEffect(() => {
    if (success) successHeadingRef.current?.focus();
  }, [success]);
  useEffect(() => {
    if (failure) errorRef.current?.focus();
  }, [failure]);
  // V2: lỗi nguồn → focus ô nguồn khi điều khiển đã mở khoá.
  useEffect(() => {
    if (sourceError && !pending) sourceRef.current?.focus();
  }, [sourceError, pending]);

  const header = (
    <header className="adm-page-head">
      <div>
        <h1>Tải media lên</h1>
        <p>Tải ảnh hoặc âm thanh vào thư viện media kèm nguồn dữ liệu.</p>
      </div>
      <BackLink />
    </header>
  );

  if (!ingestionEnabled) {
    return (
      <div className="adm-page-stack adm-import-page">
        {header}
        <p className="adm-card adm-panel" role="note">
          Tính năng tải media đang tạm tắt.
        </p>
      </div>
    );
  }

  const noSources = dataSources.length === 0;
  const locked = noSources || pending;

  function clearMessages() {
    setFailure(null);
    setSourceError(null);
    setSuccess(null);
  }

  function acceptFile(file: File) {
    requestIdRef.current += 1;
    setPending(false);
    clearMessages();
    const check = checkMediaFile(file);
    if (!check.ok) {
      setSelected(null);
      setIdempotencyKey(null);
      setFileError(check.message);
      return;
    }
    setSelected({ file, mimeType: check.mimeType });
    setFileError(null);
    setIdempotencyKey(newKey());
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Xoá value để chọn lại đúng tệp vẫn phát change.
    event.target.value = '';
    if (file) acceptFile(file);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsOver(false);
    if (locked) return;
    const file = event.dataTransfer.files?.[0];
    if (file) acceptFile(file);
  }

  function onSourceChange(event: ChangeEvent<HTMLSelectElement>) {
    requestIdRef.current += 1;
    setPending(false);
    setDataSourceId(event.target.value);
    clearMessages();
    setIdempotencyKey(selected ? newKey() : null);
  }

  async function onUpload() {
    if (locked || selected === null || dataSourceId === '') return;
    const key = idempotencyKey ?? newKey();
    if (idempotencyKey === null) setIdempotencyKey(key);
    const requestId = ++requestIdRef.current;
    setPending(true);
    clearMessages();
    const form = new FormData();
    form.append('file', canonicalMediaFile(selected.file, selected.mimeType));
    let status = 0;
    let body: unknown = null;
    try {
      const response = await fetch(
        `${UPLOAD_URL}?dataSourceId=${encodeURIComponent(dataSourceId)}`,
        { method: 'POST', headers: { 'idempotency-key': key }, body: form },
      );
      status = response.status;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
    } catch {
      // Lỗi mạng: mã null, giữ key để thử lại.
      if (requestId !== requestIdRef.current) return;
      setPending(false);
      setFailure(mediaUploadErrorLabel(null));
      return;
    }
    if (requestId !== requestIdRef.current) return;
    setPending(false);
    if (status === 401) {
      router.push('/login');
      return;
    }
    if (status === 403) {
      router.push('/forbidden');
      return;
    }
    const done =
      status >= 200 && status < 300
        ? readSuccess(body, selected.file.name)
        : null;
    if (done) {
      setSuccess(done);
      setIdempotencyKey(null);
      return;
    }
    const code = readCode(body);
    if (status === 409 && code !== null && RENEW_KEY_CODES.has(code)) {
      setIdempotencyKey(newKey());
    }
    // 503 (gồm MEDIA_INGESTION_BUSY, MEDIA_UPLOAD_BFF_TIMEOUT) và 409 IN_PROGRESS giữ key.
    const label = mediaUploadErrorLabel(code);
    if (code === SOURCE_NOT_APPROVED) {
      setSourceError(label.message);
      return;
    }
    setFailure(label);
  }

  function resetForAnother() {
    requestIdRef.current += 1;
    setPending(false);
    setSelected(null);
    setFileError(null);
    setIdempotencyKey(null);
    clearMessages();
    if (fileInputRef.current) fileInputRef.current.value = '';
    // Nút chọn tệp render lại sau khi khối thành công đóng.
    setTimeout(() => chooseButtonRef.current?.focus(), 0);
  }

  const canUpload = !locked && selected !== null && dataSourceId !== '';
  // Z7: đúng một câu lý do khi nút tắt (không áp dụng nhánh không nguồn —
  // câu "không nguồn" đã là lý do).
  const uploadHint = canUpload
    ? null
    : pending
      ? 'Đang tải lên…'
      : noSources
        ? null
        : 'Chọn nguồn dữ liệu và tệp để tải lên.';
  const sourceDescribedBy =
    [
      noSources ? 'media-sources-empty' : null,
      sourceError ? 'media-source-error' : null,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div className="adm-page-stack adm-import-page">
      {header}

      {noSources ? (
        <p
          className="adm-card adm-panel adm-import-error"
          role="note"
          id="media-sources-empty"
        >
          Chưa có nguồn dữ liệu đủ giấy phép để tải media. Liên hệ quản trị hệ
          thống để thêm nguồn.
        </p>
      ) : null}

      {success ? (
        <section
          className="adm-card adm-panel adm-import-success"
          aria-labelledby="media-success-heading"
        >
          <h2 id="media-success-heading" ref={successHeadingRef} tabIndex={-1}>
            Tải lên thành công
          </h2>
          <p>
            {`Đã tải lên ${success.filename}. Trạng thái: ${processingStatusLabel(success.processingStatus)}.`}
            {success.idempotent ? ' Tệp này đã được tải trước đó.' : null}
          </p>
          <div className="adm-import-footer">
            <Link
              className="adm-btn adm-btn--primary"
              href={`/admin/media/${success.id}`}
            >
              Xem chi tiết
            </Link>
            <button
              className="adm-btn adm-btn--outline"
              type="button"
              onClick={resetForAnother}
            >
              Tải tệp khác
            </button>
          </div>
        </section>
      ) : (
        <form
          className="adm-card adm-panel"
          aria-labelledby="media-form-heading"
          aria-busy={pending ? 'true' : undefined}
          onSubmit={(event) => {
            event.preventDefault();
            void onUpload();
          }}
        >
          <h2 id="media-form-heading">Chọn nguồn và tệp</h2>
          <div className="adm-import-field">
            <label className="adm-import-field__label" htmlFor="media-source">
              Nguồn dữ liệu *
            </label>
            <select
              className="adm-import-select"
              id="media-source"
              ref={sourceRef}
              value={dataSourceId}
              onChange={onSourceChange}
              disabled={locked}
              aria-invalid={sourceError ? 'true' : undefined}
              aria-describedby={sourceDescribedBy}
            >
              <option value="">Chọn nguồn dữ liệu</option>
              {dataSources.map((source) => (
                <option key={source.id} value={String(source.id)}>
                  {`${source.name} · ${source.code} · ${source.version}`}
                </option>
              ))}
            </select>
            {sourceError ? (
              <p
                className="adm-import-error"
                id="media-source-error"
                role="alert"
              >
                {sourceError}
              </p>
            ) : null}
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
            <label className="adm-import-drop__label" htmlFor="media-file">
              Kéo thả tệp vào đây hoặc chọn tệp
            </label>
            <input
              className="sr-only"
              id="media-file"
              ref={fileInputRef}
              type="file"
              accept={MEDIA_UPLOAD_ACCEPT}
              tabIndex={-1}
              onChange={onFileChange}
              disabled={locked}
              aria-describedby={
                fileError
                  ? 'media-file-help media-file-error'
                  : 'media-file-help'
              }
            />
            <div className="adm-import-file">
              {selected ? (
                <span className="adm-import-file__name">
                  {selected.file.name} ·{' '}
                  <span className="adm-import-file__size">
                    {formatMediaBytes(selected.file.size)}
                  </span>
                </span>
              ) : null}
              <button
                className="adm-btn adm-btn--outline"
                type="button"
                ref={chooseButtonRef}
                onClick={() => fileInputRef.current?.click()}
                disabled={locked}
              >
                {selected ? 'Chọn tệp khác' : 'Chọn tệp'}
              </button>
            </div>
            <p className="adm-import-help" id="media-file-help">
              {MEDIA_UPLOAD_TEXT.hint}
            </p>
            {fileError ? (
              <p
                className="adm-import-error"
                id="media-file-error"
                role="alert"
              >
                {fileError}
              </p>
            ) : null}
          </div>

          <div className="adm-import-footer">
            <button
              className="adm-btn adm-btn--primary"
              type="submit"
              disabled={!canUpload}
              aria-describedby={
                uploadHint
                  ? 'media-upload-hint'
                  : noSources
                    ? 'media-sources-empty'
                    : undefined
              }
            >
              Tải lên
            </button>
          </div>
          {uploadHint ? (
            <p className="adm-import-hint" id="media-upload-hint">
              {uploadHint}
            </p>
          ) : null}
        </form>
      )}

      {/* Z5: aria-live chỉ bọc vùng thông báo ngắn. */}
      <div aria-live="polite">
        {pending ? (
          <p className="adm-import-hint">Đang tải lên và kiểm tra tệp…</p>
        ) : null}
      </div>
      {failure ? (
        <div
          className="adm-card adm-panel adm-import-error"
          role="alert"
          tabIndex={-1}
          ref={errorRef}
        >
          {failure.message}
          {failure.unknownCode ? (
            <>
              {' '}
              (<code>{failure.unknownCode}</code>)
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
