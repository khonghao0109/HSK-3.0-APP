'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useRef, useState, useTransition } from 'react';

import {
  contentConflictMessage,
  levelLabel,
} from '@/features/admin-shell/admin-labels';

import { FORBIDDEN_MESSAGE, SESSION_LOGIN_PATH } from './content-values';
import type { LessonFormValues } from './lesson-values';

export { lessonPrefillFromSnapshot } from './lesson-values';
export type { LessonFormValues } from './lesson-values';

/**
 * Form "Thông tin chung" của bài học (M5.1a, Q91, TL-15).
 * - create: POST /api/admin/content/lessons (CreateLesson = revision + levelId),
 *   thành công điều hướng tới trang sửa của bài vừa tạo.
 * - edit: sửa = tạo bản sửa mới (POST …/revisions, TL-15); cấp độ chỉ đọc vì
 *   LessonRevision DTO không có levelId (TL-12); thành công router.refresh().
 * Client thuần: không import module kéo Zod (client-bundle-guard); response
 * BFF parse JSON thường, không Zod.
 */

export type LessonLevelOption = { id: number; code: string };

type CreateProps = {
  mode: 'create';
  levels: LessonLevelOption[];
  initial?: Partial<LessonFormValues>;
};

type EditProps = {
  mode: 'edit';
  lessonId: number;
  /** Nhãn cấp độ đã qua levelLabel ở page, hiển thị read-only (TL-12). */
  levelText: string;
  /** Bài đã lưu trữ: mọi mutation sẽ 409 nên form khoá toàn bộ (Q91). */
  archived: boolean;
  initial: LessonFormValues;
};

export type LessonFormProps = CreateProps | EditProps;

/**
 * Prefill TL-15: đọc snapshot của bản sửa mới nhất; khi snapshot không đọc
 * được (dữ liệu lạ) trả null để page rơi về giá trị đang live của bài học.
 * Snapshot là JsonValue nên kiểm từng trường thay vì tin ép kiểu. Hàm thuần,
 * không kéo Zod — page server và spec dùng chung.
 */
type FieldKey = 'title' | 'levelId' | 'description' | 'orderIndex' | 'slug';

type FieldErrors = Partial<Record<FieldKey, string>>;

const FIELD_ORDER: FieldKey[] = [
  'title',
  'levelId',
  'description',
  'orderIndex',
  'slug',
];

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const GENERIC_ERROR = 'Thao tác tạm thời không khả dụng. Hãy thử lại.';
const INVALID_ERROR = 'Dữ liệu chưa hợp lệ. Kiểm tra lại các trường.';

export function LessonForm(props: LessonFormProps) {
  const router = useRouter();
  const { mode } = props;
  const initial = props.initial;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [orderIndex, setOrderIndex] = useState(
    initial?.orderIndex === undefined ? '' : String(initial.orderIndex),
  );
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [levelId, setLevelId] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setPending] = useState(false);
  // R12: giữ pending tới khi router.refresh() xong.
  const [refreshing, startRefresh] = useTransition();
  const pending = submitting || refreshing;

  const titleRef = useRef<HTMLInputElement>(null);
  const levelRef = useRef<HTMLSelectElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const orderIndexRef = useRef<HTMLInputElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const fieldRefs: Record<FieldKey, { current: HTMLElement | null }> = {
    title: titleRef,
    levelId: levelRef,
    description: descriptionRef,
    orderIndex: orderIndexRef,
    slug: slugRef,
  };

  const archived = mode === 'edit' && props.archived;
  const disabled = pending || archived;

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (title.trim().length === 0) {
      next.title = 'Vui lòng nhập tiêu đề bài học.';
    } else if (title.trim().length > 200) {
      next.title = 'Tiêu đề tối đa 200 ký tự.';
    }
    if (mode === 'create' && levelId === '') {
      next.levelId = 'Vui lòng chọn cấp độ.';
    }
    if (description.trim().length > 2000) {
      next.description = 'Mô tả tối đa 2000 ký tự.';
    }
    if (orderIndex.trim() === '') {
      next.orderIndex = 'Vui lòng nhập thứ tự.';
    } else {
      const parsed = Number(orderIndex);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000000) {
        next.orderIndex = 'Thứ tự phải là số nguyên từ 1 đến 1000000.';
      }
    }
    if (slug.trim().length === 0) {
      next.slug = 'Vui lòng nhập slug.';
    } else if (slug.trim().length > 160) {
      next.slug = 'Slug tối đa 160 ký tự.';
    } else if (!SLUG_PATTERN.test(slug.trim())) {
      next.slug =
        'Slug chỉ gồm chữ cái thường, chữ số và dấu gạch ngang (ví dụ: bai-12-du-lich).';
    }
    return next;
  }

  async function readErrorCode(
    response: Response,
  ): Promise<string | undefined> {
    try {
      const payload = (await response.json()) as {
        error?: { code?: unknown };
      };
      return typeof payload.error?.code === 'string'
        ? payload.error.code
        : undefined;
    } catch {
      return undefined;
    }
  }

  /** Như mock: gõ lại vào field đã lỗi thì gỡ lỗi inline của field đó. */
  function clearFieldError(key: FieldKey) {
    setErrors((current) =>
      current[key] ? { ...current, [key]: undefined } : current,
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    setFormError(null);
    const nextErrors = validate();
    setErrors(nextErrors);
    const firstInvalid = FIELD_ORDER.find((key) => nextErrors[key]);
    if (firstInvalid) {
      fieldRefs[firstInvalid].current?.focus();
      return;
    }
    setPending(true);
    const body: Record<string, unknown> = {
      title: title.trim(),
      orderIndex: Number(orderIndex),
      slug: slug.trim(),
    };
    const trimmedDescription = description.trim();
    if (trimmedDescription !== '') body.description = trimmedDescription;
    const url =
      mode === 'create'
        ? '/api/admin/content/lessons'
        : `/api/admin/content/lessons/${props.lessonId}/revisions`;
    if (mode === 'create') body.levelId = Number(levelId);
    let keepPending = false;
    try {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        if (mode === 'create') {
          const payload = (await response.json()) as {
            data?: { lesson?: { id?: unknown } };
          };
          const newId = payload.data?.lesson?.id;
          if (typeof newId !== 'number') {
            setFormError(GENERIC_ERROR);
            return;
          }
          keepPending = true;
          router.push(`/admin/content/lessons/${newId}`);
          return;
        }
        keepPending = true;
        startRefresh(() => {
          router.refresh();
          setPending(false);
        });
        return;
      }
      if (response.status === 401) {
        keepPending = true;
        router.replace(SESSION_LOGIN_PATH);
        return;
      }
      if (response.status === 403) {
        setFormError(FORBIDDEN_MESSAGE);
      } else if (response.status === 409) {
        setFormError(contentConflictMessage(await readErrorCode(response)));
      } else if (response.status === 400 || response.status === 422) {
        setFormError(INVALID_ERROR);
      } else {
        setFormError(GENERIC_ERROR);
      }
    } catch {
      setFormError(GENERIC_ERROR);
    } finally {
      if (!keepPending) setPending(false);
    }
  }

  return (
    <form className="adm-lesson-form" onSubmit={submit} noValidate>
      {archived ? (
        <p className="adm-muted">Bài học đã lưu trữ, chỉ xem.</p>
      ) : null}
      <div className="adm-lesson-form__row">
        <div className="adm-field">
          <label className="adm-field__label" htmlFor="lesson-form-title">
            Tiêu đề *
          </label>
          <input
            ref={titleRef}
            className="adm-input"
            id="lesson-form-title"
            name="title"
            type="text"
            maxLength={200}
            required
            disabled={disabled}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              clearFieldError('title');
            }}
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={
              errors.title ? 'lesson-form-title-error' : undefined
            }
          />
          {errors.title ? (
            <p className="adm-field__error" id="lesson-form-title-error">
              {errors.title}
            </p>
          ) : null}
        </div>
        <div className="adm-field">
          {mode === 'create' ? (
            <>
              <label className="adm-field__label" htmlFor="lesson-form-level">
                Cấp độ *
              </label>
              <select
                ref={levelRef}
                className="adm-input"
                id="lesson-form-level"
                name="levelId"
                required
                disabled={disabled}
                value={levelId}
                onChange={(event) => {
                  setLevelId(event.target.value);
                  clearFieldError('levelId');
                }}
                aria-invalid={errors.levelId ? true : undefined}
                aria-describedby={
                  errors.levelId ? 'lesson-form-level-error' : undefined
                }
              >
                <option value="" disabled>
                  Chọn cấp độ
                </option>
                {props.levels.map((level) => (
                  <option key={level.id} value={String(level.id)}>
                    {levelLabel(level.code)}
                  </option>
                ))}
              </select>
              {errors.levelId ? (
                <p className="adm-field__error" id="lesson-form-level-error">
                  {errors.levelId}
                </p>
              ) : null}
            </>
          ) : (
            <>
              {/* R13: nhãn + giá trị chỉ đọc gom trong group có tên, không đặt
                  aria-labelledby lên <p>. */}
              <div role="group" aria-labelledby="lesson-form-level-label">
                <span className="adm-field__label" id="lesson-form-level-label">
                  Cấp độ
                </span>
                <p className="adm-lesson-form__static">{props.levelText}</p>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="adm-field">
        <label className="adm-field__label" htmlFor="lesson-form-description">
          Mô tả
        </label>
        <textarea
          ref={descriptionRef}
          className="adm-input"
          id="lesson-form-description"
          name="description"
          rows={3}
          maxLength={2000}
          disabled={disabled}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
            clearFieldError('description');
          }}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={
            errors.description ? 'lesson-form-description-error' : undefined
          }
        />
        {errors.description ? (
          <p className="adm-field__error" id="lesson-form-description-error">
            {errors.description}
          </p>
        ) : null}
      </div>
      <div className="adm-lesson-form__row adm-lesson-form__row--even">
        <div className="adm-field">
          <label className="adm-field__label" htmlFor="lesson-form-order">
            Thứ tự *
          </label>
          <input
            ref={orderIndexRef}
            className="adm-input"
            id="lesson-form-order"
            name="orderIndex"
            type="number"
            inputMode="numeric"
            min={1}
            max={1000000}
            step={1}
            required
            disabled={disabled}
            value={orderIndex}
            onChange={(event) => {
              setOrderIndex(event.target.value);
              clearFieldError('orderIndex');
            }}
            aria-invalid={errors.orderIndex ? true : undefined}
            aria-describedby={
              errors.orderIndex ? 'lesson-form-order-error' : undefined
            }
          />
          {errors.orderIndex ? (
            <p className="adm-field__error" id="lesson-form-order-error">
              {errors.orderIndex}
            </p>
          ) : null}
        </div>
        <div className="adm-field">
          <label className="adm-field__label" htmlFor="lesson-form-slug">
            Slug *
          </label>
          <input
            ref={slugRef}
            className="adm-input"
            id="lesson-form-slug"
            name="slug"
            type="text"
            maxLength={160}
            required
            disabled={disabled}
            value={slug}
            onChange={(event) => {
              setSlug(event.target.value);
              clearFieldError('slug');
            }}
            aria-invalid={errors.slug ? true : undefined}
            aria-describedby={
              errors.slug ? 'lesson-form-slug-error' : undefined
            }
          />
          {errors.slug ? (
            <p className="adm-field__error" id="lesson-form-slug-error">
              {errors.slug}
            </p>
          ) : null}
        </div>
      </div>
      {formError ? (
        <p className="adm-form-error" role="alert">
          {formError}
        </p>
      ) : null}
      {archived ? null : (
        <div className="adm-lesson-form__actions">
          <button
            className="adm-btn adm-btn--primary"
            type="submit"
            disabled={disabled}
          >
            {pending
              ? mode === 'create'
                ? 'Đang tạo…'
                : 'Đang lưu…'
              : mode === 'create'
                ? 'Tạo bài học'
                : 'Lưu bản sửa'}
          </button>
        </div>
      )}
    </form>
  );
}
