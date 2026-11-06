'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useRef, useState, useTransition } from 'react';

import {
  contentConflictMessage,
  topicTypeLabel,
} from '@/features/admin-shell/admin-labels';

import {
  FORBIDDEN_MESSAGE,
  SESSION_LOGIN_PATH,
  type TopicFormInitial,
} from './content-values';

/**
 * Form tạo/sửa chủ đề (M5.1a, Q90/Q91). Client chỉ kiểm required/độ dài các
 * trường thường; cú pháp và kích thước JSON do route BFF kiểm khi server
 * parse (client gửi `contentText` thô), trả mã INVALID_JSON (kèm dòng/cột)
 * hoặc JSON_TOO_LARGE để form hiện câu tiếng Việt tương ứng.
 *
 * Module này ở client bundle nên không import gì kéo Zod: nhãn loại chủ đề
 * qua topicTypeLabel (admin-labels, module thuần); mảng giá trị liệt kê lại
 * khớp topicTypes trong content-contract.ts (server-only).
 */
const TOPIC_TYPES = [
  'vocabulary',
  'grammar',
  'key_text',
  'quiz',
  'ai_speaking',
] as const;

/** Mẫu tối thiểu prefill khi tạo mới (Q90): mảng một block text rỗng. */
const CONTENT_TEXT_SAMPLE = '[\n  { "type": "text", "value": "" }\n]';

export type { TopicFormInitial } from './content-values';

type InvalidField = 'title' | 'subtitle' | 'content' | 'orderIndex' | null;

export function TopicForm({
  mode,
  lessonId,
  topicId,
  initial,
  archived = false,
}: {
  mode: 'create' | 'edit';
  lessonId: number;
  /** Bắt buộc khi mode="edit". */
  topicId?: number;
  initial?: TopicFormInitial;
  archived?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<InvalidField>(null);
  const [submittingState, setPending] = useState(false);
  // R12: giữ pending tới khi router.refresh() xong.
  const [refreshing, startRefresh] = useTransition();
  const pending = submittingState || refreshing;

  const submitting = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const subtitleRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const orderRef = useRef<HTMLInputElement>(null);
  // Focus sau render: khi lỗi server đến lúc pending, fieldset còn disabled
  // nên focus() đồng bộ bị bỏ qua — đợi render sau khi mở lại (như
  // content-workflow.tsx).
  const focusTarget = useRef<InvalidField>(null);

  useEffect(() => {
    if (focusTarget.current === null) return;
    const element = {
      title: titleRef,
      subtitle: subtitleRef,
      content: contentRef,
      orderIndex: orderRef,
    }[focusTarget.current]?.current;
    if (!element || element.disabled) return;
    element.focus();
    focusTarget.current = null;
  });

  function fail(field: InvalidField, message: string): void {
    setError(message);
    setInvalidField(field);
    focusTarget.current = field;
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting.current) return;
    setError(null);
    setInvalidField(null);

    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    const subtitle = String(form.get('subtitle') ?? '');
    const type = String(form.get('type') ?? '');
    const contentText = String(form.get('contentText') ?? '');
    const orderIndex = Number(String(form.get('orderIndex') ?? '').trim());

    if (title.length < 1) {
      fail('title', 'Vui lòng nhập tiêu đề chủ đề.');
      return;
    }
    if (title.length > 200) {
      fail('title', 'Tiêu đề tối đa 200 ký tự.');
      return;
    }
    if (subtitle.length > 500) {
      fail('subtitle', 'Phụ đề tối đa 500 ký tự.');
      return;
    }
    if (contentText.trim().length < 1) {
      fail('content', 'Vui lòng nhập nội dung JSON.');
      return;
    }
    if (
      !Number.isInteger(orderIndex) ||
      orderIndex < 1 ||
      orderIndex > 1_000_000
    ) {
      fail('orderIndex', 'Thứ tự phải là số nguyên từ 1 đến 1000000.');
      return;
    }

    submitting.current = true;
    setPending(true);
    let keepPending = false;
    try {
      const response = await fetch(
        mode === 'create'
          ? '/api/admin/content/topics'
          : `/api/admin/content/topics/${topicId}/revisions`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...(mode === 'create' ? { lessonId } : {}),
            title,
            subtitle: subtitle.trim() === '' ? null : subtitle,
            type,
            contentText,
            orderIndex,
            isPremium: form.get('isPremium') !== null,
            isLocked: form.get('isLocked') !== null,
          }),
        },
      );

      if (response.ok) {
        if (mode === 'create') {
          const payload: unknown = await response.json().catch(() => null);
          const id =
            typeof payload === 'object' && payload !== null
              ? (payload as { data?: { topic?: { id?: unknown } } }).data?.topic
                  ?.id
              : undefined;
          keepPending = true;
          if (typeof id === 'number') {
            router.push(`/admin/content/topics/${id}`);
          } else {
            startRefresh(() => {
              router.refresh();
              setPending(false);
            });
          }
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

      const payload: unknown = await response.json().catch(() => null);
      const failure =
        typeof payload === 'object' && payload !== null
          ? (
              payload as {
                error?: { code?: unknown; line?: unknown; column?: unknown };
              }
            ).error
          : undefined;
      const code = typeof failure?.code === 'string' ? failure.code : undefined;

      if (response.status === 400 && code === 'INVALID_JSON') {
        const line =
          typeof failure?.line === 'number' ? failure.line : undefined;
        const column =
          typeof failure?.column === 'number' ? failure.column : undefined;
        fail(
          'content',
          line !== undefined && column !== undefined
            ? `JSON sai ở dòng ${line}, cột ${column}`
            : 'JSON không hợp lệ.',
        );
      } else if (response.status === 400 && code === 'JSON_TOO_LARGE') {
        fail('content', 'Nội dung JSON vượt quá 100 KB.');
      } else if (response.status === 400) {
        fail(null, 'Dữ liệu chưa hợp lệ. Kiểm tra lại các trường.');
      } else if (response.status === 403) {
        fail(null, FORBIDDEN_MESSAGE);
      } else if (response.status === 409) {
        fail(null, contentConflictMessage(code));
      } else {
        fail(null, 'Thao tác tạm thời không khả dụng. Hãy thử lại.');
      }
    } catch {
      fail(null, 'Thao tác tạm thời không khả dụng. Hãy thử lại.');
    } finally {
      submitting.current = false;
      if (!keepPending) setPending(false);
    }
  }

  /** Lỗi field trỏ tới thông báo chung (role="alert") qua aria-describedby. */
  function describedBy(field: InvalidField): string | undefined {
    return invalidField === field && error ? 'topic-form-error' : undefined;
  }

  return (
    <div className="adm-topic-form-stack">
      <p className="adm-topic-form__back">
        <Link className="adm-link" href={`/admin/content/lessons/${lessonId}`}>
          ← Bài học
        </Link>
      </p>
      {archived ? (
        <p className="adm-muted" role="note">
          Chủ đề đã lưu trữ, chỉ xem.
        </p>
      ) : null}
      <form onSubmit={submit} noValidate aria-busy={pending || undefined}>
        <fieldset className="adm-topic-form" disabled={pending || archived}>
          <div className="adm-field">
            <label className="adm-field__label" htmlFor="topic-form-title">
              Tiêu đề<span aria-hidden="true"> *</span>
            </label>
            <input
              ref={titleRef}
              className="adm-input"
              id="topic-form-title"
              name="title"
              type="text"
              maxLength={200}
              required
              defaultValue={initial?.title ?? ''}
              aria-invalid={invalidField === 'title' ? true : undefined}
              aria-describedby={describedBy('title')}
            />
          </div>

          <div className="adm-field">
            <label className="adm-field__label" htmlFor="topic-form-subtitle">
              Phụ đề
            </label>
            <textarea
              ref={subtitleRef}
              className="adm-input"
              id="topic-form-subtitle"
              name="subtitle"
              rows={2}
              maxLength={500}
              defaultValue={initial?.subtitle ?? ''}
              aria-invalid={invalidField === 'subtitle' ? true : undefined}
              aria-describedby={describedBy('subtitle')}
            />
          </div>

          <div className="adm-field">
            <label className="adm-field__label" htmlFor="topic-form-type">
              Loại<span aria-hidden="true"> *</span>
            </label>
            <select
              className="adm-input"
              id="topic-form-type"
              name="type"
              required
              defaultValue={initial?.type ?? 'vocabulary'}
            >
              {TOPIC_TYPES.map((type) => (
                <option key={type} value={type}>
                  {topicTypeLabel(type)}
                </option>
              ))}
            </select>
          </div>

          <div className="adm-field">
            <label className="adm-field__label" htmlFor="topic-form-content">
              Nội dung JSON<span aria-hidden="true"> *</span>
            </label>
            <textarea
              ref={contentRef}
              className="adm-input adm-topic-form__json"
              id="topic-form-content"
              name="contentText"
              rows={14}
              required
              spellCheck={false}
              defaultValue={initial?.contentText ?? CONTENT_TEXT_SAMPLE}
              aria-invalid={invalidField === 'content' ? true : undefined}
              aria-describedby={describedBy('content')}
            />
          </div>

          <div className="adm-field">
            <label className="adm-field__label" htmlFor="topic-form-order">
              Thứ tự<span aria-hidden="true"> *</span>
            </label>
            <input
              ref={orderRef}
              className="adm-input"
              id="topic-form-order"
              name="orderIndex"
              type="number"
              min={1}
              max={1_000_000}
              step={1}
              required
              defaultValue={initial?.orderIndex ?? ''}
              aria-invalid={invalidField === 'orderIndex' ? true : undefined}
              aria-describedby={describedBy('orderIndex')}
            />
          </div>

          <label className="adm-topic-form__check" htmlFor="topic-form-premium">
            <input
              id="topic-form-premium"
              name="isPremium"
              type="checkbox"
              defaultChecked={initial?.isPremium ?? false}
            />
            Premium
          </label>
          <label className="adm-topic-form__check" htmlFor="topic-form-locked">
            <input
              id="topic-form-locked"
              name="isLocked"
              type="checkbox"
              defaultChecked={initial?.isLocked ?? false}
            />
            Khoá
          </label>

          {error ? (
            <p className="adm-form-error" id="topic-form-error" role="alert">
              {error}
            </p>
          ) : null}

          {archived ? null : (
            <div className="adm-topic-form__actions">
              <button
                className="adm-btn adm-btn--primary"
                type="submit"
                disabled={pending}
              >
                {pending
                  ? mode === 'create'
                    ? 'Đang tạo…'
                    : 'Đang lưu…'
                  : mode === 'create'
                    ? 'Tạo chủ đề'
                    : 'Lưu bản sửa'}
              </button>
            </div>
          )}
        </fieldset>
      </form>
    </div>
  );
}
