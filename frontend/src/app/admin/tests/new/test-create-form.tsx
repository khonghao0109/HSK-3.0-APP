'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { levelLabel } from '@/features/admin-shell/admin-labels';
import {
  TEST_LIMITS,
  testPublishReasonLabel,
  type TestCreateInput,
  type TestLevelOption,
} from '@/features/tests/test-values';

/**
 * Form tạo đề thi (TL-107): client thuần, không import Zod. Submit POST JSON
 * tới BFF `/api/admin/tests`; 201 → mở trang soạn cấu trúc đề, 400/422 → hiện
 * lỗi cạnh đúng ô theo `error.details.path`.
 */

type FieldName = 'levelId' | 'title' | 'duration' | 'passScore' | 'instruction';
type FieldErrors = Partial<Record<FieldName, string>>;
type Announcement = { tone: 'ok' | 'error'; text: string };

type FormValue = {
  levelId: string;
  title: string;
  duration: string;
  passScore: string;
  instruction: string;
};

const FIELD_ORDER: readonly FieldName[] = [
  'levelId',
  'title',
  'duration',
  'passScore',
  'instruction',
];

const FIELD_MESSAGES: Record<FieldName, string> = {
  levelId: 'Chọn cấp HSK cho đề thi.',
  title: `Nhập tên đề từ 1 đến ${String(TEST_LIMITS.titleMaxLength)} ký tự.`,
  duration: `Thời gian là số nguyên từ ${String(TEST_LIMITS.durationMin)} đến ${String(TEST_LIMITS.durationMax)} phút.`,
  passScore: 'Điểm đỗ phải là số nguyên không âm.',
  instruction: `Hướng dẫn tối đa ${String(TEST_LIMITS.instructionMaxLength)} ký tự.`,
};

const GENERIC_ERROR = 'Thao tác tạm thời không khả dụng. Hãy thử lại.';
const FORBIDDEN_ERROR = 'Bạn không có quyền tạo đề thi.';
const SUCCESS_MESSAGE = 'Đã tạo đề thi.';

function initialValue(levels: readonly TestLevelOption[]): FormValue {
  return {
    levelId: levels[0] ? String(levels[0].id) : '',
    title: '',
    duration: '',
    passScore: '',
    instruction: '',
  };
}

function parseInteger(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/u.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function validate(value: FormValue): FieldErrors {
  const errors: FieldErrors = {};
  if (!value.levelId) errors.levelId = FIELD_MESSAGES.levelId;
  const title = value.title.trim();
  if (title.length < 1 || title.length > TEST_LIMITS.titleMaxLength) {
    errors.title = FIELD_MESSAGES.title;
  }
  const duration = parseInteger(value.duration);
  if (
    duration === null ||
    duration < TEST_LIMITS.durationMin ||
    duration > TEST_LIMITS.durationMax
  ) {
    errors.duration = FIELD_MESSAGES.duration;
  }
  if (value.passScore.trim() !== '' && parseInteger(value.passScore) === null) {
    errors.passScore = FIELD_MESSAGES.passScore;
  }
  if (value.instruction.trim().length > TEST_LIMITS.instructionMaxLength) {
    errors.instruction = FIELD_MESSAGES.instruction;
  }
  return errors;
}

/** Path backend (`title`, `body.title`, `errors[0].path`) → tên field form. */
function fieldForServerPath(path: string | undefined): FieldName | undefined {
  if (!path) return undefined;
  const normalized = path
    .replace(/^body\./u, '')
    .replace(/\[\d+\]/gu, '')
    .split('.')[0];
  return FIELD_ORDER.find((field) => field === normalized);
}

function focusField(field: FieldName): void {
  document.getElementById(`tst-create-${field}`)?.focus();
}

function focusAlert(): void {
  document.getElementById('tst-create-alert')?.focus();
}

/** 422 (`level_not_found`) ưu tiên câu tiếng Việt của backend; còn lại dùng
 * thông điệp theo ô để không hiện mã lạ. */
function fieldMessage(
  status: number,
  code: string | undefined,
  field: FieldName,
): string {
  if (status !== 422 || code === undefined) return FIELD_MESSAGES[field];
  const label = testPublishReasonLabel(code);
  return label === code ? FIELD_MESSAGES[field] : label;
}

type ServerFailure = { code?: string; path?: string };

async function readFailure(response: Response): Promise<ServerFailure> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return {};
    const error = (body as { error?: unknown }).error;
    if (typeof error !== 'object' || error === null) return {};
    const record = error as { code?: unknown; details?: unknown };
    const path = pathFromDetails(record.details);
    return {
      ...(typeof record.code === 'string' ? { code: record.code } : {}),
      ...(path === undefined ? {} : { path }),
    };
  } catch {
    return {};
  }
}

/** `details.path` (422) hoặc `details.errors[0].path` (400 validation). */
function pathFromDetails(details: unknown): string | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const record = details as { path?: unknown; errors?: unknown };
  if (typeof record.path === 'string') return record.path;
  if (!Array.isArray(record.errors)) return undefined;
  for (const item of record.errors) {
    if (typeof item !== 'object' || item === null) continue;
    const path = (item as { path?: unknown }).path;
    if (typeof path === 'string') return path;
  }
  return undefined;
}

function readCreatedTestId(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const data = (body as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return null;
  const id = (data as { id?: unknown }).id;
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0
    ? id
    : null;
}

function buildPayload(value: FormValue): TestCreateInput {
  const payload: TestCreateInput = {
    levelId: Number(value.levelId),
    title: value.title.trim(),
    duration: Number(value.duration.trim()),
  };
  const passScore = parseInteger(value.passScore);
  if (value.passScore.trim() !== '' && passScore !== null) {
    payload.passScore = passScore;
  }
  const instruction = value.instruction.trim();
  if (instruction !== '') payload.instruction = instruction;
  return payload;
}

export function TestCreateForm({
  levels,
}: {
  levels: readonly TestLevelOption[];
}) {
  const router = useRouter();
  const [value, setValue] = useState<FormValue>(() => initialValue(levels));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [pending, setPending] = useState(false);

  function update(field: FieldName, next: string): void {
    setValue((current) => ({ ...current, [field]: next }));
    setErrors((current) => {
      if (current[field] === undefined) return current;
      const nextErrors = { ...current };
      delete nextErrors[field];
      return nextErrors;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    setAnnouncement(null);
    const localErrors = validate(value);
    if (Object.keys(localErrors).length > 0) {
      setErrors(localErrors);
      const first = FIELD_ORDER.find(
        (field) => localErrors[field] !== undefined,
      );
      if (first) focusField(first);
      else focusAlert();
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const response = await fetch('/api/admin/tests', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildPayload(value)),
      });
      if (response.status === 401) {
        // C6: giống các form admin khác — về trang đăng nhập kèm lý do phiên.
        router.replace('/login?reason=session');
        return;
      }
      if (response.status === 403) {
        setAnnouncement({ tone: 'error', text: FORBIDDEN_ERROR });
        focusAlert();
        return;
      }
      if (response.status === 400 || response.status === 422) {
        const failure = await readFailure(response);
        const field = fieldForServerPath(failure.path);
        if (field) {
          setErrors({
            [field]: fieldMessage(response.status, failure.code, field),
          });
          focusField(field);
        } else {
          // Không map được về ô nào: chỉ một thông báo chung (yêu cầu TL-107).
          setAnnouncement({ tone: 'error', text: GENERIC_ERROR });
          focusAlert();
        }
        return;
      }
      if (!response.ok) {
        setAnnouncement({ tone: 'error', text: GENERIC_ERROR });
        focusAlert();
        return;
      }
      const testId = readCreatedTestId(await response.json());
      setAnnouncement({ tone: 'ok', text: SUCCESS_MESSAGE });
      if (testId === null) {
        router.push('/admin/tests');
        return;
      }
      router.push(`/admin/tests/${String(testId)}`);
    } catch {
      setAnnouncement({ tone: 'error', text: GENERIC_ERROR });
      focusAlert();
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="tst-create-form"
      onSubmit={submit}
      noValidate
      aria-busy={pending}
    >
      <div className="tst-create-form__grid">
        <div className="adm-field">
          <label className="adm-field__label" htmlFor="tst-create-levelId">
            Cấp HSK
          </label>
          <select
            className="adm-input"
            id="tst-create-levelId"
            required
            value={value.levelId}
            aria-invalid={errors.levelId ? true : undefined}
            aria-describedby={
              errors.levelId ? 'tst-create-levelId-error' : undefined
            }
            onChange={(event) => update('levelId', event.target.value)}
          >
            <option value="" disabled>
              Chọn cấp HSK
            </option>
            {levels.map((level) => (
              <option key={level.id} value={level.id}>
                {levelLabel(level.code)}
              </option>
            ))}
          </select>
          <p className="tst-create__error" id="tst-create-levelId-error">
            {errors.levelId}
          </p>
        </div>

        <div className="adm-field">
          <label className="adm-field__label" htmlFor="tst-create-title">
            Tên đề
          </label>
          <input
            className="adm-input"
            id="tst-create-title"
            required
            maxLength={TEST_LIMITS.titleMaxLength}
            value={value.title}
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={
              errors.title ? 'tst-create-title-error' : undefined
            }
            onChange={(event) => update('title', event.target.value)}
          />
          <p className="tst-create__error" id="tst-create-title-error">
            {errors.title}
          </p>
        </div>

        <div className="adm-field">
          <label className="adm-field__label" htmlFor="tst-create-duration">
            Thời gian (phút)
          </label>
          <input
            className="adm-input"
            id="tst-create-duration"
            type="number"
            required
            min={TEST_LIMITS.durationMin}
            max={TEST_LIMITS.durationMax}
            step={1}
            inputMode="numeric"
            value={value.duration}
            aria-invalid={errors.duration ? true : undefined}
            aria-describedby={
              errors.duration ? 'tst-create-duration-error' : undefined
            }
            onChange={(event) => update('duration', event.target.value)}
          />
          <p className="tst-create__error" id="tst-create-duration-error">
            {errors.duration}
          </p>
        </div>

        <div className="adm-field">
          <label className="adm-field__label" htmlFor="tst-create-passScore">
            Điểm đỗ
          </label>
          <input
            className="adm-input"
            id="tst-create-passScore"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={value.passScore}
            aria-invalid={errors.passScore ? true : undefined}
            aria-describedby="tst-create-passScore-hint tst-create-passScore-error"
            onChange={(event) => update('passScore', event.target.value)}
          />
          <p className="tst-create__hint" id="tst-create-passScore-hint">
            Không bắt buộc; so với điểm tối đa khi xuất bản.
          </p>
          <p className="tst-create__error" id="tst-create-passScore-error">
            {errors.passScore}
          </p>
        </div>
      </div>

      <div className="adm-field">
        <label className="adm-field__label" htmlFor="tst-create-instruction">
          Hướng dẫn
        </label>
        <textarea
          className="adm-input tst-create__textarea"
          id="tst-create-instruction"
          rows={4}
          maxLength={TEST_LIMITS.instructionMaxLength}
          value={value.instruction}
          aria-invalid={errors.instruction ? true : undefined}
          aria-describedby={
            errors.instruction
              ? 'tst-create-instruction-error'
              : 'tst-create-instruction-hint'
          }
          onChange={(event) => update('instruction', event.target.value)}
        />
        <p className="tst-create__hint" id="tst-create-instruction-hint">
          Không bắt buộc, tối đa {TEST_LIMITS.instructionMaxLength} ký tự.
        </p>
        <p className="tst-create__error" id="tst-create-instruction-error">
          {errors.instruction}
        </p>
      </div>

      <p className="tst-create__live" role="status">
        {announcement?.tone === 'ok' ? announcement.text : null}
      </p>
      <p
        className="adm-form-error tst-create__alert"
        id="tst-create-alert"
        role="alert"
        tabIndex={-1}
      >
        {announcement?.tone === 'error' ? announcement.text : null}
      </p>

      <div className="tst-create-form__actions">
        <button
          className="adm-btn adm-btn--primary"
          type="submit"
          disabled={pending}
        >
          {pending ? 'Đang tạo…' : 'Tạo đề thi'}
        </button>
      </div>
    </form>
  );
}
