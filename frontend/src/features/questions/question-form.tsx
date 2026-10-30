'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useRef, useState } from 'react';

import { AdminIcon } from '@/features/admin-shell/admin-icon';
import {
  levelLabel,
  questionConflictMessage,
  questionValidationMessage,
} from '@/features/admin-shell/admin-labels';

import {
  QUESTION_DIFFICULTY_OPTIONS,
  QUESTION_MAX_TAG,
  QUESTION_MAX_TAGS,
  QUESTION_MAX_TEXT,
  QUESTION_SKILL_OPTIONS,
  QUESTION_TYPE_OPTIONS,
  fieldForServerPath,
  nextStableId,
  questionFormToPayload,
  type QuestionFormType,
  type QuestionFormValue,
  type QuestionTagSuggestion,
} from './question-values';

/**
 * Form soạn/sửa câu hỏi (M4.1a, TL-91) theo pattern `exercise-form.tsx`:
 * - create: POST `/api/admin/questions`, thành công gọi `onSaved(id)`.
 * - edit: POST `/api/admin/questions/:id/revisions`, thành công gọi `onSaved()`.
 * - Client thuần: không import Zod; 422 map `error.details.path` về đúng ô.
 */

export type QuestionMediaOption = {
  id: number;
  filename: string | null;
  processingStatus: string;
};

export type QuestionFormProps = {
  mode: 'create' | 'edit';
  initial: QuestionFormValue;
  levels: Array<{ id: number; code: string }>;
  tags: QuestionTagSuggestion[];
  audio: QuestionMediaOption[];
  image: QuestionMediaOption[];
  submitPath: string;
  archived?: boolean;
  onSaved: (questionId?: number) => void;
};

const GENERIC_ERROR = 'Thao tác tạm thời không khả dụng. Hãy thử lại.';
const MAX_OPTIONS = 100;
const MAX_TOKENS = 100;
const MAX_ACCEPTED = 100;

type FieldErrors = Record<string, string>;
type Announcement = { tone: 'ok' | 'error'; text: string };

const FIELD_ORDER: string[] = [
  'levelId',
  'content',
  'type',
  'options',
  'correctOptionId',
  'trueFalse',
  'acceptedTexts',
  'tokens',
  'tags',
  'explanation',
  'objective',
];

function FieldError({ id, message }: { id: string; message?: string }) {
  if (message === undefined) return null;
  return (
    <p className="adm-field__error" id={id}>
      {message}
    </p>
  );
}

function focusField(field: string): void {
  if (typeof document === 'undefined') return;
  const element =
    document.getElementById(`qn-${field}`) ??
    document.querySelector<HTMLElement>(`[data-field="${field}"] input`);
  element?.focus();
}

function typeSpecificDefaults(
  value: QuestionFormValue,
  type: QuestionFormType,
): QuestionFormValue {
  if (type === value.type) return value;
  const next: QuestionFormValue = { ...value, type };
  if (type === 'mcq' && next.options.length < 2) {
    next.options = [
      { id: nextStableId('opt'), text: '' },
      { id: nextStableId('opt'), text: '' },
    ];
  }
  if (type === 'true_false') next.trueFalse = '';
  if (type === 'fill_blank' && next.acceptedTexts.length === 0) {
    next.acceptedTexts = [''];
  }
  if (type === 'arrange_sentence' && next.tokens.length < 2) {
    next.tokens = [
      { id: nextStableId('tok'), text: '' },
      { id: nextStableId('tok'), text: '' },
    ];
  }
  return next;
}

export function QuestionForm(props: QuestionFormProps) {
  const router = useRouter();
  const [value, setValue] = useState<QuestionFormValue>(props.initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const tagInputRef = useRef<HTMLInputElement>(null);

  const archived = props.archived === true;

  function update<K extends keyof QuestionFormValue>(
    key: K,
    next: QuestionFormValue[K],
  ): void {
    setValue((current) => ({ ...current, [key]: next }));
  }

  function addTag(): void {
    const name = tagDraft.trim();
    if (name.length === 0) return;
    if (name.length > QUESTION_MAX_TAG) {
      setErrors((current) => ({
        ...current,
        tags: `Mỗi chủ đề dài 1–${QUESTION_MAX_TAG} ký tự.`,
      }));
      return;
    }
    if (value.tags.length >= QUESTION_MAX_TAGS) {
      setErrors((current) => ({
        ...current,
        tags: `Tối đa ${QUESTION_MAX_TAGS} chủ đề.`,
      }));
      return;
    }
    if (value.tags.some((tag) => tag.toLowerCase() === name.toLowerCase())) {
      setErrors((current) => ({
        ...current,
        tags: 'Chủ đề này đã có trong danh sách.',
      }));
      return;
    }
    setErrors((current) => {
      const next = { ...current };
      delete next.tags;
      return next;
    });
    update('tags', [...value.tags, name]);
    setTagDraft('');
    tagInputRef.current?.focus();
  }

  function removeTag(name: string): void {
    update(
      'tags',
      value.tags.filter((tag) => tag !== name),
    );
  }

  function addOption(): void {
    if (value.options.length >= MAX_OPTIONS) return;
    update('options', [
      ...value.options,
      { id: nextStableId('opt'), text: '' },
    ]);
  }

  function updateOption(id: string, text: string): void {
    update(
      'options',
      value.options.map((option) =>
        option.id === id ? { ...option, text } : option,
      ),
    );
  }

  function removeOption(id: string): void {
    const options = value.options.filter((option) => option.id !== id);
    update('options', options);
    if (value.correctOptionId === id) update('correctOptionId', '');
  }

  function moveToken(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= value.tokens.length) return;
    const tokens = [...value.tokens];
    const [token] = tokens.splice(index, 1);
    if (token) tokens.splice(target, 0, token);
    update('tokens', tokens);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (archived || pending) return;
    setAnnouncement(null);
    const result = questionFormToPayload(value);
    if (!result.ok) {
      setErrors(result.errors);
      const first = FIELD_ORDER.find((field) => result.errors[field]);
      if (first) focusField(first);
      else document.getElementById('qn-form-error')?.focus();
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const response = await fetch(props.submitPath, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(result.payload),
      });
      if (response.status === 401) {
        router.replace('/login?reason=session');
        return;
      }
      if (!response.ok) {
        const failure = await readFailure(response);
        if (response.status === 422) {
          const field = fieldForServerPath(failure.path);
          const message = questionValidationMessage(failure.code);
          if (field) {
            setErrors({ [field]: message });
            focusField(field);
          } else {
            setAnnouncement({ tone: 'error', text: message });
            document.getElementById('qn-form-error')?.focus();
          }
        } else if (response.status === 409) {
          setAnnouncement({
            tone: 'error',
            text: questionConflictMessage(failure.code),
          });
        } else {
          setAnnouncement({ tone: 'error', text: GENERIC_ERROR });
        }
        return;
      }
      const body: unknown = await response.json();
      const questionId = readQuestionId(body);
      setAnnouncement({ tone: 'ok', text: 'Đã lưu câu hỏi.' });
      props.onSaved(questionId ?? undefined);
    } catch {
      setAnnouncement({ tone: 'error', text: GENERIC_ERROR });
    } finally {
      setPending(false);
    }
  }

  if (archived) {
    return (
      <p className="adm-muted" id="qn-archived-notice">
        Câu hỏi đã lưu trữ — không thể tạo bản sửa.
      </p>
    );
  }

  const levelError = errors.levelId;
  return (
    <form
      className="qn-form adm-page-stack"
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <p
        className={`qn-live${announcement ? ` qn-live--${announcement.tone}` : ''}`}
        role="status"
        aria-live="polite"
      >
        {announcement ? announcement.text : null}
      </p>

      <div className="qn-form__grid">
        <div className="adm-field">
          <label className="adm-field__label" htmlFor="qn-type">
            Loại câu hỏi <span aria-hidden="true">*</span>
          </label>
          <select
            className="adm-input"
            id="qn-type"
            value={value.type}
            onChange={(event) =>
              setValue(
                typeSpecificDefaults(
                  value,
                  event.target.value as QuestionFormType,
                ),
              )
            }
          >
            {QUESTION_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <FieldError id="qn-type-error" message={errors.type} />
        </div>

        <div className="adm-field">
          <label className="adm-field__label" htmlFor="qn-level">
            Cấp độ HSK <span aria-hidden="true">*</span>
          </label>
          <select
            className="adm-input"
            id="qn-level"
            value={value.levelId === '' ? '' : String(value.levelId)}
            aria-invalid={levelError ? true : undefined}
            aria-describedby={levelError ? 'qn-level-error' : undefined}
            onChange={(event) =>
              update(
                'levelId',
                event.target.value === '' ? '' : Number(event.target.value),
              )
            }
          >
            <option value="">Chọn cấp độ</option>
            {props.levels.map((level) => (
              <option key={level.id} value={level.id}>
                {levelLabel(level.code)}
              </option>
            ))}
          </select>
          <FieldError id="qn-level-error" message={levelError} />
        </div>

        <div className="adm-field">
          <label className="adm-field__label" htmlFor="qn-skill">
            Kỹ năng <span aria-hidden="true">*</span>
          </label>
          <select
            className="adm-input"
            id="qn-skill"
            value={value.skill}
            onChange={(event) =>
              update('skill', event.target.value as QuestionFormValue['skill'])
            }
          >
            {QUESTION_SKILL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <FieldError id="qn-skill-error" message={errors.skill} />
        </div>

        <div className="adm-field">
          <label className="adm-field__label" htmlFor="qn-difficulty">
            Độ khó
          </label>
          <select
            className="adm-input"
            id="qn-difficulty"
            value={value.difficulty}
            onChange={(event) =>
              update(
                'difficulty',
                event.target.value as QuestionFormValue['difficulty'],
              )
            }
          >
            {QUESTION_DIFFICULTY_OPTIONS.map((option) => (
              <option key={option.value || 'none'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <FieldError id="qn-difficulty-error" message={errors.difficulty} />
        </div>
      </div>

      <div className="adm-field">
        <label className="adm-field__label" htmlFor="qn-content">
          Nội dung câu hỏi <span aria-hidden="true">*</span>
        </label>
        <textarea
          className="adm-input qn-textarea"
          id="qn-content"
          rows={3}
          maxLength={QUESTION_MAX_TEXT}
          value={value.content}
          aria-invalid={errors.content ? true : undefined}
          aria-describedby={errors.content ? 'qn-content-error' : undefined}
          onChange={(event) => update('content', event.target.value)}
        />
        <FieldError id="qn-content-error" message={errors.content} />
      </div>

      {value.type === 'mcq' ? (
        <fieldset className="qn-fieldset" data-field="options">
          <legend>Lựa chọn và đáp án đúng</legend>
          <ol className="qn-option-list">
            {value.options.map((option, index) => (
              <li key={option.id} className="qn-option">
                <label
                  className="qn-option__radio"
                  htmlFor={`qn-correct-${option.id}`}
                >
                  <input
                    type="radio"
                    name="qn-correct-option"
                    id={`qn-correct-${option.id}`}
                    checked={value.correctOptionId === option.id}
                    aria-label={`Đáp án đúng là lựa chọn ${index + 1}`}
                    onChange={() => update('correctOptionId', option.id)}
                  />
                </label>
                <label className="sr-only" htmlFor={`qn-option-${option.id}`}>
                  Lựa chọn {index + 1}
                </label>
                <input
                  className="adm-input"
                  id={`qn-option-${option.id}`}
                  value={option.text}
                  maxLength={QUESTION_MAX_TEXT}
                  onChange={(event) =>
                    updateOption(option.id, event.target.value)
                  }
                />
                <button
                  className="adm-btn adm-btn--ghost adm-btn--sm"
                  type="button"
                  aria-label={`Xoá lựa chọn ${index + 1}`}
                  onClick={() => removeOption(option.id)}
                >
                  <AdminIcon name="x" className="adm-icon adm-icon--sm" />
                </button>
              </li>
            ))}
          </ol>
          <div className="qn-actions-row">
            <button
              className="adm-btn adm-btn--outline adm-btn--sm"
              type="button"
              onClick={addOption}
              disabled={value.options.length >= MAX_OPTIONS}
            >
              Thêm lựa chọn
            </button>
          </div>
          <FieldError id="qn-options-error" message={errors.options} />
          <FieldError
            id="qn-correctOptionId-error"
            message={errors.correctOptionId}
          />
        </fieldset>
      ) : null}

      {value.type === 'true_false' ? (
        <fieldset className="qn-fieldset" data-field="trueFalse">
          <legend>Đáp án đúng</legend>
          <div className="qn-radio-row">
            <label className="qn-radio">
              <input
                type="radio"
                name="qn-true-false"
                id="qn-trueFalse"
                checked={value.trueFalse === 'true'}
                onChange={() => update('trueFalse', 'true')}
              />
              Đúng
            </label>
            <label className="qn-radio">
              <input
                type="radio"
                name="qn-true-false"
                checked={value.trueFalse === 'false'}
                onChange={() => update('trueFalse', 'false')}
              />
              Sai
            </label>
          </div>
          <FieldError id="qn-trueFalse-error" message={errors.trueFalse} />
        </fieldset>
      ) : null}

      {value.type === 'fill_blank' ? (
        <fieldset className="qn-fieldset" data-field="acceptedTexts">
          <legend>Đáp án chấp nhận</legend>
          <ol className="qn-accepted-list">
            {value.acceptedTexts.map((text, index) => (
              <li key={`accepted-${index}`} className="qn-option">
                <label className="sr-only" htmlFor={`qn-accepted-${index}`}>
                  Đáp án chấp nhận {index + 1}
                </label>
                <input
                  className="adm-input"
                  id={`qn-accepted-${index}`}
                  value={text}
                  maxLength={QUESTION_MAX_TEXT}
                  onChange={(event) =>
                    update(
                      'acceptedTexts',
                      value.acceptedTexts.map((item, itemIndex) =>
                        itemIndex === index ? event.target.value : item,
                      ),
                    )
                  }
                />
                <button
                  className="adm-btn adm-btn--ghost adm-btn--sm"
                  type="button"
                  aria-label={`Xoá đáp án chấp nhận ${index + 1}`}
                  disabled={value.acceptedTexts.length <= 1}
                  onClick={() =>
                    update(
                      'acceptedTexts',
                      value.acceptedTexts.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    )
                  }
                >
                  <AdminIcon name="x" className="adm-icon adm-icon--sm" />
                </button>
              </li>
            ))}
          </ol>
          <div className="qn-actions-row">
            <button
              className="adm-btn adm-btn--outline adm-btn--sm"
              type="button"
              disabled={value.acceptedTexts.length >= MAX_ACCEPTED}
              onClick={() =>
                update('acceptedTexts', [...value.acceptedTexts, ''])
              }
            >
              Thêm đáp án
            </button>
            <label className="qn-check">
              <input
                type="checkbox"
                checked={value.caseSensitive}
                onChange={(event) =>
                  update('caseSensitive', event.target.checked)
                }
              />
              Phân biệt chữ hoa/thường
            </label>
          </div>
          <FieldError
            id="qn-acceptedTexts-error"
            message={errors.acceptedTexts}
          />
        </fieldset>
      ) : null}

      {value.type === 'arrange_sentence' ? (
        <fieldset className="qn-fieldset" data-field="tokens">
          <legend>Các mảnh câu theo thứ tự đúng</legend>
          <ol className="qn-token-list">
            {value.tokens.map((token, index) => (
              <li key={token.id} className="qn-token">
                <span className="qn-token__index">{index + 1}</span>
                <label className="sr-only" htmlFor={`qn-token-${token.id}`}>
                  Mảnh câu {index + 1}
                </label>
                <input
                  className="adm-input"
                  id={`qn-token-${token.id}`}
                  value={token.text}
                  maxLength={QUESTION_MAX_TEXT}
                  onChange={(event) =>
                    update(
                      'tokens',
                      value.tokens.map((item) =>
                        item.id === token.id
                          ? { ...item, text: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <button
                  className="adm-btn adm-btn--ghost adm-btn--sm"
                  type="button"
                  aria-label={`Đưa mảnh câu ${index + 1} lên`}
                  disabled={index === 0}
                  onClick={() => moveToken(index, -1)}
                >
                  Lên
                </button>
                <button
                  className="adm-btn adm-btn--ghost adm-btn--sm"
                  type="button"
                  aria-label={`Đưa mảnh câu ${index + 1} xuống`}
                  disabled={index === value.tokens.length - 1}
                  onClick={() => moveToken(index, 1)}
                >
                  Xuống
                </button>
                <button
                  className="adm-btn adm-btn--ghost adm-btn--sm"
                  type="button"
                  aria-label={`Xoá mảnh câu ${index + 1}`}
                  disabled={value.tokens.length <= 2}
                  onClick={() =>
                    update(
                      'tokens',
                      value.tokens.filter((item) => item.id !== token.id),
                    )
                  }
                >
                  <AdminIcon name="x" className="adm-icon adm-icon--sm" />
                </button>
              </li>
            ))}
          </ol>
          <div className="qn-actions-row">
            <button
              className="adm-btn adm-btn--outline adm-btn--sm"
              type="button"
              disabled={value.tokens.length >= MAX_TOKENS}
              onClick={() =>
                update('tokens', [
                  ...value.tokens,
                  { id: nextStableId('tok'), text: '' },
                ])
              }
            >
              Thêm mảnh câu
            </button>
          </div>
          <FieldError id="qn-tokens-error" message={errors.tokens} />
        </fieldset>
      ) : null}

      <fieldset className="qn-fieldset" data-field="tags">
        <legend>Chủ đề (tags)</legend>
        <div className="qn-tag-row">
          <label className="sr-only" htmlFor="qn-tag-input">
            Nhập tên chủ đề
          </label>
          <input
            className="adm-input"
            id="qn-tag-input"
            ref={tagInputRef}
            list="qn-tag-suggestions"
            maxLength={QUESTION_MAX_TAG}
            value={tagDraft}
            placeholder="Nhập tên chủ đề"
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addTag();
              }
            }}
          />
          <datalist id="qn-tag-suggestions">
            {props.tags.map((tag) => (
              <option key={tag.slug} value={tag.name} />
            ))}
          </datalist>
          <button
            className="adm-btn adm-btn--outline adm-btn--sm"
            type="button"
            onClick={addTag}
          >
            Thêm
          </button>
        </div>
        {value.tags.length > 0 ? (
          <ul className="qn-tag-list" aria-label="Chủ đề đã chọn">
            {value.tags.map((tag) => (
              <li key={tag} className="qn-tag">
                {tag}
                <button
                  className="adm-btn adm-btn--ghost adm-btn--sm"
                  type="button"
                  aria-label={`Bỏ chủ đề ${tag}`}
                  onClick={() => removeTag(tag)}
                >
                  <AdminIcon name="x" className="adm-icon adm-icon--sm" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <FieldError id="qn-tags-error" message={errors.tags} />
      </fieldset>

      <div className="qn-form__grid">
        <div className="adm-field">
          <label className="adm-field__label" htmlFor="qn-audio">
            Audio
          </label>
          <select
            className="adm-input"
            id="qn-audio"
            value={value.audioId === '' ? '' : String(value.audioId)}
            onChange={(event) =>
              update(
                'audioId',
                event.target.value === '' ? '' : Number(event.target.value),
              )
            }
          >
            <option value="">Không dùng audio</option>
            {props.audio.map((media) => (
              <option key={media.id} value={media.id}>
                {media.filename ?? `Media #${media.id}`}
              </option>
            ))}
          </select>
          <FieldError id="qn-audio-error" message={errors.audio} />
        </div>
        <div className="adm-field">
          <label className="adm-field__label" htmlFor="qn-image">
            Ảnh
          </label>
          <select
            className="adm-input"
            id="qn-image"
            value={value.imageId === '' ? '' : String(value.imageId)}
            onChange={(event) =>
              update(
                'imageId',
                event.target.value === '' ? '' : Number(event.target.value),
              )
            }
          >
            <option value="">Không dùng ảnh</option>
            {props.image.map((media) => (
              <option key={media.id} value={media.id}>
                {media.filename ?? `Media #${media.id}`}
              </option>
            ))}
          </select>
          <FieldError id="qn-image-error" message={errors.image} />
        </div>
      </div>

      <div className="adm-field">
        <label className="adm-field__label" htmlFor="qn-explanation">
          Giải thích
        </label>
        <textarea
          className="adm-input qn-textarea"
          id="qn-explanation"
          rows={3}
          maxLength={QUESTION_MAX_TEXT}
          value={value.explanation}
          aria-invalid={errors.explanation ? true : undefined}
          aria-describedby={
            errors.explanation ? 'qn-explanation-error' : undefined
          }
          onChange={(event) => update('explanation', event.target.value)}
        />
        <FieldError id="qn-explanation-error" message={errors.explanation} />
      </div>

      <div className="adm-field">
        <label className="adm-field__label" htmlFor="qn-objective">
          Mục tiêu
        </label>
        <input
          className="adm-input"
          id="qn-objective"
          maxLength={500}
          value={value.objective}
          aria-invalid={errors.objective ? true : undefined}
          aria-describedby={errors.objective ? 'qn-objective-error' : undefined}
          onChange={(event) => update('objective', event.target.value)}
        />
        <FieldError id="qn-objective-error" message={errors.objective} />
      </div>

      <p
        className="adm-form-error"
        id="qn-form-error"
        role="alert"
        tabIndex={-1}
      >
        {announcement?.tone === 'error' ? announcement.text : null}
      </p>

      <div className="adm-page-head__actions">
        <button
          className="adm-btn adm-btn--primary"
          type="submit"
          disabled={pending}
        >
          {pending
            ? 'Đang lưu…'
            : props.mode === 'create'
              ? 'Tạo câu hỏi'
              : 'Lưu bản sửa'}
        </button>
      </div>
    </form>
  );
}

async function readFailure(
  response: Response,
): Promise<{ code?: string; path?: string }> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return {};
    const error = (body as { error?: unknown }).error;
    if (typeof error !== 'object' || error === null) return {};
    const record = error as {
      code?: unknown;
      details?: { path?: unknown; reasons?: unknown };
    };
    return {
      ...(typeof record.code === 'string' ? { code: record.code } : {}),
      ...(typeof record.details?.path === 'string'
        ? { path: record.details.path }
        : {}),
    };
  } catch {
    return {};
  }
}

function readQuestionId(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const data = (body as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return null;
  const question = (data as { question?: unknown }).question;
  if (typeof question !== 'object' || question === null) return null;
  const id = (question as { id?: unknown }).id;
  return typeof id === 'number' && Number.isSafeInteger(id) ? id : null;
}
