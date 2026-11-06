'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useRef, useState } from 'react';

import {
  contentConflictMessage,
  EXERCISE_FORM,
  EXERCISE_FORM_MESSAGE,
  EXERCISE_FORM_TYPE_OPTIONS,
  exerciseValidationMessage,
} from '@/features/admin-shell/admin-labels';

import {
  EXERCISE_UNPUBLISHABLE_REASON,
  FORBIDDEN_MESSAGE,
  SESSION_LOGIN_PATH,
} from '../content/content-values';

import {
  emptyExerciseFormValue,
  exerciseFormToPayload,
  isExerciseFormType,
  payloadTokenDisplayIds,
  type ExerciseFormProps,
  type ExerciseFormType,
  type ExerciseFormValue,
} from './exercise-form-values';

export {
  exerciseFormToPayload,
  exercisePrefillFromSnapshot,
} from './exercise-form-values';
export type { ExerciseFormValue } from './exercise-form-values';

/**
 * Form soạn/sửa bài tập theo từng loại (M5.1b1, TL-19, TL-20, Q96).
 *
 * - create: POST props.submitPath (BFF /api/admin/exercises), kèm lessonId và
 *   topicId; thành công đọc data.exercise.id rồi gọi onSaved(id).
 * - edit: POST props.submitPath (…/:id/revisions); thành công gọi onSaved() để
 *   page gọi router.refresh().
 * - Client thuần: không import Zod; response BFF parse JSON thường.
 * - 422: map error.details.path về đúng ô; path lạ/không có → vùng lỗi chung.
 */

const GENERIC_ERROR = 'Thao tác tạm thời không khả dụng. Hãy thử lại.';
const LESSON_REQUIRED = 'Chọn bài học.';
const TYPE_RESET_NOTICE = 'Phần riêng của loại trước đã được đặt lại.';
const MAX_TEXT = 4_096;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 100;
const MIN_ACCEPTED = 1;
const MAX_ACCEPTED = 100;
const MIN_TOKENS = 2;
const MAX_TOKENS = 100;
const MIN_ORDER = 1;
const MAX_ORDER = 1_000_000;

type FieldErrors = Record<string, string>;

type ValidationResult = { errors: FieldErrors; order: string[] };

type ServerFailure = { code?: string; path?: string };

function FieldError({
  id,
  message,
}: {
  id: string;
  message: string | undefined;
}) {
  if (message === undefined) return null;
  return (
    <p className="adm-field__error" id={id}>
      {message}
    </p>
  );
}

function ariaFor(errorId: string, errors: FieldErrors) {
  return errors[errorId] === undefined
    ? {}
    : { 'aria-invalid': true as const, 'aria-describedby': errorId };
}

/**
 * X5: cấp id mới chưa từng dùng trong phiên form. Tập "đã dùng" = id hiện có
 * ∪ id đã cấp trước đó, nên xoá `opt-3` rồi thêm không tái sử dụng `opt-3`.
 */
function allocateStableId(
  prefix: 'opt' | 'tok',
  currentIds: readonly string[],
  issuedIds: Set<string>,
): string {
  const used = new Set<string>([...currentIds, ...issuedIds]);
  let index = 1;
  while (used.has(`${prefix}-${index}`)) index += 1;
  const id = `${prefix}-${index}`;
  issuedIds.add(id);
  return id;
}

type AllocateId = (prefix: 'opt' | 'tok') => string;

/** Mặc định cố định khi tạo form, hoặc cấp id qua allocator (đổi loại). */
function blankOptions(allocate?: AllocateId): ExerciseFormValue['options'] {
  return [
    { id: allocate === undefined ? 'opt-1' : allocate('opt'), text: '' },
    { id: allocate === undefined ? 'opt-2' : allocate('opt'), text: '' },
  ];
}

function blankTokens(allocate?: AllocateId): ExerciseFormValue['tokens'] {
  return [
    { id: allocate === undefined ? 'tok-1' : allocate('tok'), text: '' },
    { id: allocate === undefined ? 'tok-2' : allocate('tok'), text: '' },
  ];
}

type SpecificFields = Pick<
  ExerciseFormValue,
  | 'options'
  | 'correctOptionId'
  | 'acceptedTexts'
  | 'caseSensitive'
  | 'tokens'
  | 'tokenOrder'
  | 'referenceText'
  | 'mediaId'
>;

/** Đổi loại: state riêng của loại cũ bị xoá hoàn toàn (không giữ id/text). */
function typeSpecificDefaults(
  type: ExerciseFormType,
  allocate: AllocateId,
): SpecificFields {
  const isChoice = type === 'mcq' || type === 'listening_choice';
  const tokens = type === 'arrange_sentence' ? blankTokens(allocate) : [];
  return {
    options: isChoice ? blankOptions(allocate) : [],
    correctOptionId: '',
    acceptedTexts: type === 'fill_blank' ? [''] : [],
    caseSensitive: false,
    tokens,
    tokenOrder: tokens.map((token) => token.id),
    referenceText: '',
    mediaId: null,
  };
}

function createInitialValue(): ExerciseFormValue {
  return {
    ...emptyExerciseFormValue(),
    // Form tạo mới bắt đầu với 2 lựa chọn trống (mức tối thiểu của TL-19);
    // `emptyExerciseFormValue` vẫn là mcq rỗng cho fallback dữ liệu hỏng.
    options: blankOptions(),
  };
}

function normalizeInitialValue(initial: ExerciseFormValue): ExerciseFormValue {
  return { ...initial, tokenOrder: initial.tokens.map((token) => token.id) };
}

function isChoiceType(
  type: ExerciseFormType,
): type is 'mcq' | 'listening_choice' {
  return type === 'mcq' || type === 'listening_choice';
}

function optionsTarget(value: ExerciseFormValue) {
  const first = value.options[0];
  return {
    errorId: 'exercise-form-options-error',
    focusId: first
      ? `exercise-form-option-${first.id}`
      : 'exercise-form-add-option',
  };
}

function acceptedTarget(value: ExerciseFormValue) {
  return {
    errorId: 'exercise-form-accepted-error',
    focusId:
      value.acceptedTexts.length > 0
        ? 'exercise-form-accepted-0'
        : 'exercise-form-add-accepted',
  };
}

function tokensTarget(value: ExerciseFormValue) {
  const first = value.tokens[0];
  return {
    errorId: 'exercise-form-tokens-error',
    focusId: first
      ? `exercise-form-token-${first.id}`
      : 'exercise-form-add-token',
  };
}

function correctTarget(value: ExerciseFormValue) {
  const first = value.options[0];
  return {
    errorId: 'exercise-form-correct-error',
    focusId: first
      ? `exercise-form-correct-${first.id}`
      : 'exercise-form-add-option',
  };
}

function elementIdForError(
  errorId: string,
  value: ExerciseFormValue,
): string | null {
  if (errorId === 'exercise-form-options-error') {
    return optionsTarget(value).focusId;
  }
  if (errorId === 'exercise-form-correct-error') {
    return correctTarget(value).focusId;
  }
  if (errorId === 'exercise-form-accepted-error') {
    return acceptedTarget(value).focusId;
  }
  if (errorId === 'exercise-form-tokens-error') {
    return tokensTarget(value).focusId;
  }
  const suffix = '-error';
  return errorId.endsWith(suffix) ? errorId.slice(0, -suffix.length) : null;
}

/**
 * TL-20: map `error.details.path` của backend về ô của form. Chỉ nhận path
 * đúng shape canonical; path lạ trả null để hiện vùng lỗi chung.
 */
function serverErrorTarget(
  path: string | undefined,
  value: ExerciseFormValue,
): { errorId: string; focusId: string } | null {
  if (path === undefined) return null;
  const normalized = path.startsWith('$') ? path.slice(1) : path;
  const clean = normalized.startsWith('.') ? normalized.slice(1) : normalized;
  switch (clean) {
    case 'type':
      return {
        errorId: 'exercise-form-type-error',
        focusId: 'exercise-form-type',
      };
    case 'prompt':
      return {
        errorId: 'exercise-form-prompt-error',
        focusId: 'exercise-form-prompt',
      };
    case 'explanation':
      return {
        errorId: 'exercise-form-explanation-error',
        focusId: 'exercise-form-explanation',
      };
    case 'orderIndex':
      return {
        errorId: 'exercise-form-order-error',
        focusId: 'exercise-form-order',
      };
    case 'mediaId':
      return value.type === 'listening_choice'
        ? {
            errorId: 'exercise-form-audio-error',
            focusId: 'exercise-form-audio',
          }
        : null;
    case 'content.referenceText':
      return value.type === 'speaking_repeat'
        ? {
            errorId: 'exercise-form-reference-error',
            focusId: 'exercise-form-reference',
          }
        : null;
    case 'answer.optionId':
      return isChoiceType(value.type) ? correctTarget(value) : null;
    case 'answer.caseSensitive':
      return value.type === 'fill_blank'
        ? {
            errorId: 'exercise-form-case-error',
            focusId: 'exercise-form-case',
          }
        : null;
    case 'content.options':
    case 'content.options.$':
      return isChoiceType(value.type) ? optionsTarget(value) : null;
    case 'answer.acceptedTexts':
    case 'answer.acceptedTexts.$':
      return value.type === 'fill_blank' ? acceptedTarget(value) : null;
    case 'content.tokens':
    case 'content.tokens.$':
    case 'answer.tokenIds':
      return value.type === 'arrange_sentence' ? tokensTarget(value) : null;
    default:
      break;
  }
  const optionMatch = /^content\.options\[(\d+)\](?:\.(?:text|id))?$/u.exec(
    clean,
  );
  if (optionMatch !== null) {
    if (!isChoiceType(value.type)) return null;
    const index = Number(optionMatch[1]);
    const option = value.options[index];
    if (option !== undefined) {
      return {
        errorId: `exercise-form-option-${option.id}-error`,
        focusId: `exercise-form-option-${option.id}`,
      };
    }
    return null;
  }
  const acceptedMatch = /^answer\.acceptedTexts\[(\d+)\]$/u.exec(clean);
  if (acceptedMatch !== null) {
    if (value.type !== 'fill_blank') return null;
    const index = Number(acceptedMatch[1]);
    if (value.acceptedTexts[index] !== undefined) {
      return {
        errorId: `exercise-form-accepted-${index}-error`,
        focusId: `exercise-form-accepted-${index}`,
      };
    }
    return null;
  }
  const tokenMatch = /^content\.tokens\[(\d+)\](?:\.(?:text|id))?$/u.exec(
    clean,
  );
  if (tokenMatch !== null) {
    if (value.type !== 'arrange_sentence') return null;
    const index = Number(tokenMatch[1]);
    const token = value.tokens[index];
    if (token !== undefined) {
      return {
        errorId: `exercise-form-token-${token.id}-error`,
        focusId: `exercise-form-token-${token.id}`,
      };
    }
    return null;
  }
  return null;
}

export function ExerciseForm(props: ExerciseFormProps) {
  const router = useRouter();
  const isEdit = props.mode === 'edit';
  const editProps = props.mode === 'edit' ? props : null;
  const createProps = props.mode === 'create' ? props : null;
  const fixedLessonId =
    createProps !== null &&
    typeof createProps.initialLessonId === 'number' &&
    Number.isInteger(createProps.initialLessonId) &&
    createProps.initialLessonId > 0
      ? createProps.initialLessonId
      : null;

  // X5: id đã cấp trong phiên form. Tập này chỉ đọc/ghi trong event handler
  // (không đọc ref lúc render); seed từ id ban đầu của form.
  const [issuedStableIds] = useState<Set<string>>(() => {
    const issued = new Set<string>();
    if (editProps === null) {
      for (const option of blankOptions()) issued.add(option.id);
    } else {
      for (const option of editProps.initial.options) issued.add(option.id);
      for (const token of editProps.initial.tokens) issued.add(token.id);
    }
    return issued;
  });
  const nextStableId: AllocateId = (prefix) =>
    allocateStableId(prefix, [], issuedStableIds);
  const [value, setValue] = useState<ExerciseFormValue>(() =>
    editProps === null
      ? createInitialValue()
      : normalizeInitialValue(editProps.initial),
  );
  const [lessonId, setLessonId] = useState(
    fixedLessonId === null ? '' : String(fixedLessonId),
  );
  const [topicId, setTopicId] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // X4/X11: vùng role="status" có sẵn trong DOM; đổi nội dung theo hành động.
  const [statusMessage, setStatusMessage] = useState<string>('');
  // 422 xảy ra khi form đang pending (mọi input bị disabled) nên focus phải
  // chờ commit kế tiếp, lúc pending=false và input đã nhận lại focus. Mỗi
  // request có nonce để lần lỗi lặp lại vẫn chạy lại effect.
  const [focusRequest, setFocusRequest] = useState<{
    id: string;
    nonce: number;
  } | null>(null);
  const focusNonce = useRef(0);
  const consumedFocusNonce = useRef(0);

  useEffect(() => {
    if (focusRequest === null || pending) return;
    if (consumedFocusNonce.current === focusRequest.nonce) return;
    consumedFocusNonce.current = focusRequest.nonce;
    document.getElementById(focusRequest.id)?.focus();
  }, [focusRequest, pending]);

  const archived = editProps !== null && editProps.archived;
  const disabled = pending || archived;
  const fixedLessonTitle =
    fixedLessonId === null
      ? ''
      : (createProps?.initialLessonTitle ??
        createProps?.lessons.find((lesson) => lesson.id === fixedLessonId)
          ?.title ??
        `Bài học #${fixedLessonId}`);

  function clearFieldError(errorId: string) {
    setFieldErrors((current) => {
      if (current[errorId] === undefined) return current;
      const next = { ...current };
      delete next[errorId];
      return next;
    });
  }

  function clearErrorsWithPrefix(prefix: string) {
    setFieldErrors((current) => {
      let changed = false;
      const next: FieldErrors = {};
      for (const [key, message] of Object.entries(current)) {
        if (key.startsWith(prefix)) {
          changed = true;
          continue;
        }
        next[key] = message;
      }
      return changed ? next : current;
    });
  }

  function focusElement(id: string) {
    focusNonce.current += 1;
    setFocusRequest({ id, nonce: focusNonce.current });
  }

  function changeType(next: ExerciseFormType) {
    if (next === value.type) return;
    setValue((current) =>
      current.type === next
        ? current
        : {
            ...current,
            type: next,
            ...typeSpecificDefaults(next, nextStableId),
          },
    );
    setStatusMessage(
      next === 'listening_choice'
        ? `${TYPE_RESET_NOTICE} ${EXERCISE_FORM_MESSAGE.audioRequired}`
        : TYPE_RESET_NOTICE,
    );
    setFieldErrors({});
    setFormError(null);
  }

  function addOption() {
    setValue((current) => {
      if (current.options.length >= MAX_OPTIONS) return current;
      return {
        ...current,
        options: [
          ...current.options,
          {
            id: allocateStableId(
              'opt',
              current.options.map((option) => option.id),
              issuedStableIds,
            ),
            text: '',
          },
        ],
      };
    });
    clearFieldError('exercise-form-options-error');
  }

  function removeOption(id: string) {
    setValue((current) => ({
      ...current,
      options: current.options.filter((option) => option.id !== id),
      correctOptionId:
        current.correctOptionId === id ? '' : current.correctOptionId,
    }));
    clearFieldError(`exercise-form-option-${id}-error`);
    clearFieldError('exercise-form-options-error');
    clearFieldError('exercise-form-correct-error');
  }

  function updateOptionText(id: string, text: string) {
    setValue((current) => ({
      ...current,
      options: current.options.map((option) =>
        option.id === id ? { ...option, text } : option,
      ),
    }));
    clearFieldError(`exercise-form-option-${id}-error`);
  }

  function selectCorrectOption(id: string) {
    setValue((current) => ({ ...current, correctOptionId: id }));
    clearFieldError('exercise-form-correct-error');
  }

  function addAcceptedText() {
    setValue((current) =>
      current.acceptedTexts.length >= MAX_ACCEPTED
        ? current
        : { ...current, acceptedTexts: [...current.acceptedTexts, ''] },
    );
    clearFieldError('exercise-form-accepted-error');
  }

  function removeAcceptedText(index: number) {
    setValue((current) => ({
      ...current,
      acceptedTexts: current.acceptedTexts.filter(
        (_, itemIndex) => itemIndex !== index,
      ),
    }));
    clearErrorsWithPrefix('exercise-form-accepted-');
  }

  function updateAcceptedText(index: number, text: string) {
    setValue((current) => ({
      ...current,
      acceptedTexts: current.acceptedTexts.map((item, itemIndex) =>
        itemIndex === index ? text : item,
      ),
    }));
    clearFieldError(`exercise-form-accepted-${index}-error`);
  }

  function addToken() {
    setValue((current) => {
      if (current.tokens.length >= MAX_TOKENS) return current;
      const tokens = [
        ...current.tokens,
        {
          id: allocateStableId(
            'tok',
            current.tokens.map((token) => token.id),
            issuedStableIds,
          ),
          text: '',
        },
      ];
      return {
        ...current,
        tokens,
        tokenOrder: tokens.map((token) => token.id),
      };
    });
    clearFieldError('exercise-form-tokens-error');
  }

  function removeToken(id: string) {
    setValue((current) => {
      const tokens = current.tokens.filter((token) => token.id !== id);
      return {
        ...current,
        tokens,
        tokenOrder: tokens.map((token) => token.id),
      };
    });
    clearFieldError(`exercise-form-token-${id}-error`);
    clearFieldError('exercise-form-tokens-error');
  }

  function updateTokenText(id: string, text: string) {
    setValue((current) => ({
      ...current,
      tokens: current.tokens.map((token) =>
        token.id === id ? { ...token, text } : token,
      ),
    }));
    clearFieldError(`exercise-form-token-${id}-error`);
  }

  function moveToken(index: number, direction: 'up' | 'down') {
    setValue((current) => {
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      const token = current.tokens[index];
      const neighbour = current.tokens[targetIndex];
      if (token === undefined || neighbour === undefined) return current;
      const tokens = [...current.tokens];
      tokens[index] = neighbour;
      tokens[targetIndex] = token;
      return { ...current, tokens, tokenOrder: tokens.map((item) => item.id) };
    });
    clearErrorsWithPrefix('exercise-form-token-');
    clearFieldError('exercise-form-tokens-error');
  }

  function changeAudio(raw: string) {
    const parsed = Number(raw);
    setValue((current) => ({
      ...current,
      mediaId:
        raw === '' || !Number.isInteger(parsed) || parsed < 1 ? null : parsed,
    }));
    clearFieldError('exercise-form-audio-error');
  }

  function validate(current: ExerciseFormValue): ValidationResult {
    const errors: FieldErrors = {};
    const order: string[] = [];
    const add = (errorId: string, message: string) => {
      if (errors[errorId] === undefined) {
        errors[errorId] = message;
        order.push(errorId);
      }
    };

    if (!isExerciseFormType(current.type)) {
      add('exercise-form-type-error', EXERCISE_FORM_MESSAGE.typeRequired);
    }
    const prompt = current.prompt.trim();
    if (prompt.length === 0 || prompt.length > MAX_TEXT) {
      add('exercise-form-prompt-error', EXERCISE_FORM_MESSAGE.promptRequired);
    }
    if (current.explanation.trim().length > MAX_TEXT) {
      add(
        'exercise-form-explanation-error',
        EXERCISE_FORM_MESSAGE.explanationTooLong,
      );
    }
    const orderIndex = Number(current.orderIndex);
    if (
      current.orderIndex.trim() === '' ||
      !Number.isInteger(orderIndex) ||
      orderIndex < MIN_ORDER ||
      orderIndex > MAX_ORDER
    ) {
      add('exercise-form-order-error', EXERCISE_FORM_MESSAGE.orderIndexInvalid);
    }
    if (props.mode === 'create' && fixedLessonId === null && lessonId === '') {
      add('exercise-form-lesson-error', LESSON_REQUIRED);
    }

    if (isChoiceType(current.type)) {
      if (current.type === 'listening_choice' && current.mediaId === null) {
        add('exercise-form-audio-error', EXERCISE_FORM_MESSAGE.audioRequired);
      }
      if (
        current.options.length < MIN_OPTIONS ||
        current.options.length > MAX_OPTIONS
      ) {
        add('exercise-form-options-error', EXERCISE_FORM_MESSAGE.optionsRange);
      }
      for (const option of current.options) {
        if (option.text.trim() === '') {
          add(
            `exercise-form-option-${option.id}-error`,
            EXERCISE_FORM_MESSAGE.optionTextRequired,
          );
        }
      }
      if (
        current.options.length > 0 &&
        (current.correctOptionId === '' ||
          !current.options.some(
            (option) => option.id === current.correctOptionId,
          ))
      ) {
        add(
          'exercise-form-correct-error',
          EXERCISE_FORM_MESSAGE.correctAnswerRequired,
        );
      }
    } else if (current.type === 'fill_blank') {
      if (
        current.acceptedTexts.length < MIN_ACCEPTED ||
        current.acceptedTexts.length > MAX_ACCEPTED
      ) {
        add(
          'exercise-form-accepted-error',
          EXERCISE_FORM_MESSAGE.acceptedTextsRange,
        );
      }
      current.acceptedTexts.forEach((text, index) => {
        if (text.trim() === '') {
          add(
            `exercise-form-accepted-${index}-error`,
            EXERCISE_FORM_MESSAGE.acceptedTextRequired,
          );
        }
      });
    } else if (current.type === 'arrange_sentence') {
      if (
        current.tokens.length < MIN_TOKENS ||
        current.tokens.length > MAX_TOKENS
      ) {
        add('exercise-form-tokens-error', EXERCISE_FORM_MESSAGE.tokensRange);
      }
      for (const token of current.tokens) {
        if (token.text.trim() === '') {
          add(
            `exercise-form-token-${token.id}-error`,
            EXERCISE_FORM_MESSAGE.tokenTextRequired,
          );
        }
      }
    } else if (current.referenceText.trim().length > MAX_TEXT) {
      add(
        'exercise-form-reference-error',
        EXERCISE_FORM_MESSAGE.referenceTextTooLong,
      );
    }
    return { errors, order };
  }

  async function readFailure(response: Response): Promise<ServerFailure> {
    try {
      const payload = (await response.json()) as {
        error?: {
          code?: unknown;
          path?: unknown;
          details?: { path?: unknown };
        };
      };
      const code =
        typeof payload.error?.code === 'string'
          ? payload.error.code
          : undefined;
      const detailsPath =
        typeof payload.error?.details?.path === 'string'
          ? payload.error.details.path
          : undefined;
      const directPath =
        typeof payload.error?.path === 'string'
          ? payload.error.path
          : undefined;
      const path = detailsPath ?? directPath;
      return {
        ...(code === undefined ? {} : { code }),
        ...(path === undefined ? {} : { path }),
      };
    } catch {
      return {};
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    // Y5: mỗi lần gửi bắt đầu lại vùng status; câu "Đã lưu bản sửa." của lần
    // trước không được dính sang lần gửi lỗi tiếp theo.
    setStatusMessage('');
    setFormError(null);
    const { errors, order } = validate(value);
    setFieldErrors(errors);
    if (order.length > 0) {
      const firstError = order[0];
      if (firstError !== undefined) {
        const target = elementIdForError(firstError, value);
        if (target !== null) focusElement(target);
      }
      return;
    }

    setPending(true);
    let keepPending = false;
    try {
      const submission = exerciseFormToPayload(value, {
        previousDisplayTokenIds: value.tokenDisplayOrder,
      });
      const body: Record<string, unknown> = { ...submission };
      if (props.mode === 'create') {
        body.lessonId = fixedLessonId ?? Number(lessonId);
        body.topicId = topicId === '' ? null : Number(topicId);
      }
      const response = await fetch(props.submitPath, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        if (props.mode === 'create') {
          const payload = (await response.json()) as {
            data?: { exercise?: { id?: unknown } };
          };
          const savedId = payload.data?.exercise?.id;
          if (
            typeof savedId !== 'number' ||
            !Number.isInteger(savedId) ||
            savedId < 1
          ) {
            setFormError(GENERIC_ERROR);
            return;
          }
          keepPending = true;
          props.onSaved(savedId);
          return;
        }
        // Y3: nhớ thứ tự hiển thị vừa gửi (content.tokens) để lần lưu sau giữ
        // nguyên thứ tự cũ thay vì xáo lại từ thứ tự đáp án.
        setValue((current) =>
          submission.type === 'arrange_sentence'
            ? {
                ...current,
                tokenDisplayOrder: payloadTokenDisplayIds(submission),
              }
            : current,
        );
        // X11: báo đã lưu trong vùng role="status" và thay câu báo đổi loại.
        setStatusMessage('Đã lưu bản sửa.');
        setFieldErrors({});
        setFormError(null);
        // Page gọi router.refresh(); không giữ pending vì onSaved không trả
        // tín hiệu hoàn tất, giữ sẽ khoá form nếu refresh giữ nguyên cây client.
        props.onSaved();
        return;
      }
      if (response.status === 401) {
        keepPending = true;
        router.replace(SESSION_LOGIN_PATH);
        return;
      }
      const failure = await readFailure(response);
      if (response.status === 403) {
        setFieldErrors({});
        setFormError(FORBIDDEN_MESSAGE);
      } else if (response.status === 409) {
        setFieldErrors({});
        setFormError(contentConflictMessage(failure.code));
      } else if (response.status === 422) {
        const message = exerciseValidationMessage(failure.code);
        const target = serverErrorTarget(failure.path, value);
        if (target === null) {
          setFieldErrors({});
          setFormError(message);
        } else {
          setFieldErrors({ [target.errorId]: message });
          setFormError(null);
          focusElement(target.focusId);
        }
      } else {
        setFieldErrors({});
        setFormError(GENERIC_ERROR);
      }
    } catch {
      setFormError(GENERIC_ERROR);
    } finally {
      if (!keepPending) setPending(false);
    }
  }

  const typeError = fieldErrors['exercise-form-type-error'];
  return (
    <form
      className="adm-exercise-form"
      onSubmit={submit}
      noValidate
      aria-busy={pending || undefined}
    >
      {archived ? (
        <p className="adm-muted">Bài tập đã lưu trữ, chỉ xem.</p>
      ) : null}

      <div className="adm-exercise-form__grid">
        <div className="adm-field">
          <label className="adm-field__label" htmlFor="exercise-form-type">
            {EXERCISE_FORM.type} *
          </label>
          <select
            className="adm-input"
            id="exercise-form-type"
            name="type"
            required
            value={value.type}
            disabled={disabled}
            onChange={(event) => {
              if (isExerciseFormType(event.target.value)) {
                changeType(event.target.value);
              }
            }}
            {...ariaFor('exercise-form-type-error', fieldErrors)}
          >
            {EXERCISE_FORM_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <FieldError id="exercise-form-type-error" message={typeError} />
          {/* X4: vùng thông báo có sẵn trong DOM, chỉ đổi nội dung. */}
          <p
            className="adm-exercise-form__notice adm-exercise-form__status"
            role="status"
            aria-live="polite"
          >
            {statusMessage}
          </p>
          {value.type === 'speaking_repeat' ? (
            <p className="adm-exercise-form__notice">
              {EXERCISE_UNPUBLISHABLE_REASON}
            </p>
          ) : null}
        </div>

        <div className="adm-field">
          <label className="adm-field__label" htmlFor="exercise-form-order">
            {EXERCISE_FORM.orderIndex} *
          </label>
          <input
            className="adm-input"
            id="exercise-form-order"
            name="orderIndex"
            type="number"
            inputMode="numeric"
            min={MIN_ORDER}
            max={MAX_ORDER}
            step={1}
            required
            disabled={disabled}
            value={value.orderIndex}
            onChange={(event) => {
              setValue((current) => ({
                ...current,
                orderIndex: event.target.value,
              }));
              clearFieldError('exercise-form-order-error');
            }}
            {...ariaFor('exercise-form-order-error', fieldErrors)}
          />
          <FieldError
            id="exercise-form-order-error"
            message={fieldErrors['exercise-form-order-error']}
          />
        </div>
      </div>

      <div className="adm-field">
        <label className="adm-field__label" htmlFor="exercise-form-prompt">
          {EXERCISE_FORM.prompt} *
        </label>
        <textarea
          className="adm-input"
          id="exercise-form-prompt"
          name="prompt"
          rows={3}
          maxLength={MAX_TEXT}
          required
          disabled={disabled}
          value={value.prompt}
          onChange={(event) => {
            setValue((current) => ({
              ...current,
              prompt: event.target.value,
            }));
            clearFieldError('exercise-form-prompt-error');
          }}
          {...ariaFor('exercise-form-prompt-error', fieldErrors)}
        />
        <FieldError
          id="exercise-form-prompt-error"
          message={fieldErrors['exercise-form-prompt-error']}
        />
      </div>

      <div className="adm-field">
        <label className="adm-field__label" htmlFor="exercise-form-explanation">
          {EXERCISE_FORM.explanation}
        </label>
        <textarea
          className="adm-input"
          id="exercise-form-explanation"
          name="explanation"
          rows={2}
          maxLength={MAX_TEXT}
          disabled={disabled}
          value={value.explanation}
          onChange={(event) => {
            setValue((current) => ({
              ...current,
              explanation: event.target.value,
            }));
            clearFieldError('exercise-form-explanation-error');
          }}
          {...ariaFor('exercise-form-explanation-error', fieldErrors)}
        />
        <FieldError
          id="exercise-form-explanation-error"
          message={fieldErrors['exercise-form-explanation-error']}
        />
      </div>

      <div className="adm-exercise-form__fields">
        {createProps !== null && fixedLessonId === null ? (
          <div className="adm-field">
            <label className="adm-field__label" htmlFor="exercise-form-lesson">
              Bài học *
            </label>
            <select
              className="adm-input"
              id="exercise-form-lesson"
              name="lessonId"
              required
              disabled={disabled}
              value={lessonId}
              onChange={(event) => {
                setLessonId(event.target.value);
                clearFieldError('exercise-form-lesson-error');
              }}
              {...ariaFor('exercise-form-lesson-error', fieldErrors)}
            >
              <option value="" disabled>
                Chọn bài học
              </option>
              {createProps.lessons.map((lesson) => (
                <option key={lesson.id} value={String(lesson.id)}>
                  {lesson.title}
                </option>
              ))}
            </select>
            <FieldError
              id="exercise-form-lesson-error"
              message={fieldErrors['exercise-form-lesson-error']}
            />
          </div>
        ) : (
          <div
            className="adm-exercise-form__static-group"
            role="group"
            aria-labelledby="exercise-form-lesson-label"
          >
            <span className="adm-field__label" id="exercise-form-lesson-label">
              Bài học
            </span>
            <p className="adm-exercise-form__static">
              {editProps !== null ? editProps.lessonTitle : fixedLessonTitle}
            </p>
          </div>
        )}

        {createProps !== null ? (
          <div className="adm-field">
            <label className="adm-field__label" htmlFor="exercise-form-topic">
              Chủ đề
            </label>
            <select
              className="adm-input"
              id="exercise-form-topic"
              name="topicId"
              disabled={disabled}
              value={topicId}
              onChange={(event) => setTopicId(event.target.value)}
            >
              <option value="">Không gắn chủ đề</option>
              {createProps.topics.map((topic) => (
                <option key={topic.id} value={String(topic.id)}>
                  {topic.title}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div
            className="adm-exercise-form__static-group"
            role="group"
            aria-labelledby="exercise-form-topic-label"
          >
            <span className="adm-field__label" id="exercise-form-topic-label">
              Chủ đề
            </span>
            <p className="adm-exercise-form__static">
              {editProps?.topicTitle ?? 'Không gắn chủ đề'}
            </p>
          </div>
        )}
      </div>

      {value.type === 'listening_choice' ? (
        <div className="adm-field">
          <label className="adm-field__label" htmlFor="exercise-form-audio">
            {EXERCISE_FORM.audio} *
          </label>
          <select
            className="adm-input"
            id="exercise-form-audio"
            name="mediaId"
            required
            disabled={disabled}
            value={value.mediaId === null ? '' : String(value.mediaId)}
            onChange={(event) => changeAudio(event.target.value)}
            {...ariaFor('exercise-form-audio-error', fieldErrors)}
          >
            <option value="" disabled>
              Chọn audio
            </option>
            {props.audio.map((audio) => (
              <option key={audio.id} value={String(audio.id)}>
                {audio.filename ?? `Media #${audio.id}`}
              </option>
            ))}
            {value.mediaId !== null &&
            !props.audio.some((audio) => audio.id === value.mediaId) ? (
              <option value={String(value.mediaId)}>
                {`Media #${value.mediaId}`}
              </option>
            ) : null}
          </select>
          <FieldError
            id="exercise-form-audio-error"
            message={fieldErrors['exercise-form-audio-error']}
          />
        </div>
      ) : null}

      {isChoiceType(value.type) ? (
        <fieldset
          className="adm-exercise-form__group"
          aria-describedby={
            fieldErrors['exercise-form-options-error'] === undefined
              ? undefined
              : 'exercise-form-options-error'
          }
        >
          <legend className="adm-exercise-form__legend">
            {EXERCISE_FORM.options} (2–100) *
          </legend>
          <p className="adm-exercise-form__hint">
            {EXERCISE_FORM.correctAnswer}: chọn một lựa chọn.
          </p>
          <ol className="adm-exercise-form__list">
            {value.options.map((option, index) => {
              const optionErrorId = `exercise-form-option-${option.id}-error`;
              const correctError = fieldErrors['exercise-form-correct-error'];
              return (
                <li className="adm-exercise-form__row" key={option.id}>
                  <span className="adm-exercise-form__index" aria-hidden="true">
                    {index + 1}
                  </span>
                  <input
                    className="adm-exercise-form__radio"
                    type="radio"
                    name="exercise-form-correct"
                    id={`exercise-form-correct-${option.id}`}
                    required
                    checked={value.correctOptionId === option.id}
                    onChange={() => selectCorrectOption(option.id)}
                    aria-label={`Đáp án đúng cho lựa chọn ${index + 1}`}
                    aria-describedby={
                      correctError === undefined
                        ? undefined
                        : 'exercise-form-correct-error'
                    }
                    disabled={disabled}
                  />
                  <div className="adm-exercise-form__control">
                    <input
                      className="adm-input"
                      type="text"
                      id={`exercise-form-option-${option.id}`}
                      value={option.text}
                      maxLength={MAX_TEXT}
                      aria-label={`${EXERCISE_FORM.options} ${index + 1}`}
                      disabled={disabled}
                      onChange={(event) =>
                        updateOptionText(option.id, event.target.value)
                      }
                      {...ariaFor(optionErrorId, fieldErrors)}
                    />
                    <FieldError
                      id={optionErrorId}
                      message={fieldErrors[optionErrorId]}
                    />
                  </div>
                  <button
                    className="adm-btn adm-btn--ghost adm-btn--sm"
                    type="button"
                    aria-label={`Xoá lựa chọn ${index + 1}`}
                    disabled={disabled}
                    onClick={() => removeOption(option.id)}
                  >
                    {EXERCISE_FORM.remove}
                  </button>
                </li>
              );
            })}
          </ol>
          <FieldError
            id="exercise-form-options-error"
            message={fieldErrors['exercise-form-options-error']}
          />
          <FieldError
            id="exercise-form-correct-error"
            message={fieldErrors['exercise-form-correct-error']}
          />
          <button
            className="adm-btn adm-btn--outline adm-btn--sm"
            id="exercise-form-add-option"
            type="button"
            disabled={disabled || value.options.length >= MAX_OPTIONS}
            onClick={addOption}
          >
            {EXERCISE_FORM.addOption}
          </button>
        </fieldset>
      ) : null}

      {value.type === 'fill_blank' ? (
        <fieldset
          className="adm-exercise-form__group"
          aria-describedby={
            fieldErrors['exercise-form-accepted-error'] === undefined
              ? undefined
              : 'exercise-form-accepted-error'
          }
        >
          <legend className="adm-exercise-form__legend">
            {EXERCISE_FORM.acceptedTexts} (1–100) *
          </legend>
          <ol className="adm-exercise-form__list">
            {value.acceptedTexts.map((text, index) => {
              const errorId = `exercise-form-accepted-${index}-error`;
              return (
                <li className="adm-exercise-form__row" key={index}>
                  <span className="adm-exercise-form__index" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div className="adm-exercise-form__control">
                    <input
                      className="adm-input"
                      type="text"
                      id={`exercise-form-accepted-${index}`}
                      value={text}
                      maxLength={MAX_TEXT}
                      aria-label={`${EXERCISE_FORM.acceptedTexts} ${index + 1}`}
                      disabled={disabled}
                      onChange={(event) =>
                        updateAcceptedText(index, event.target.value)
                      }
                      {...ariaFor(errorId, fieldErrors)}
                    />
                    <FieldError id={errorId} message={fieldErrors[errorId]} />
                  </div>
                  <button
                    className="adm-btn adm-btn--ghost adm-btn--sm"
                    type="button"
                    aria-label={`Xoá đáp án ${index + 1}`}
                    disabled={disabled}
                    onClick={() => removeAcceptedText(index)}
                  >
                    {EXERCISE_FORM.remove}
                  </button>
                </li>
              );
            })}
          </ol>
          <FieldError
            id="exercise-form-accepted-error"
            message={fieldErrors['exercise-form-accepted-error']}
          />
          <button
            className="adm-btn adm-btn--outline adm-btn--sm"
            id="exercise-form-add-accepted"
            type="button"
            disabled={disabled || value.acceptedTexts.length >= MAX_ACCEPTED}
            onClick={addAcceptedText}
          >
            Thêm đáp án
          </button>
          <label
            className="adm-exercise-form__check"
            htmlFor="exercise-form-case"
          >
            <input
              id="exercise-form-case"
              type="checkbox"
              checked={value.caseSensitive}
              disabled={disabled}
              onChange={(event) => {
                setValue((current) => ({
                  ...current,
                  caseSensitive: event.target.checked,
                }));
                clearFieldError('exercise-form-case-error');
              }}
              aria-describedby={
                fieldErrors['exercise-form-case-error'] === undefined
                  ? undefined
                  : 'exercise-form-case-error'
              }
            />
            {EXERCISE_FORM.caseSensitive}
          </label>
          <FieldError
            id="exercise-form-case-error"
            message={fieldErrors['exercise-form-case-error']}
          />
        </fieldset>
      ) : null}

      {value.type === 'arrange_sentence' ? (
        <fieldset
          className="adm-exercise-form__group"
          aria-describedby={
            fieldErrors['exercise-form-tokens-error'] === undefined
              ? undefined
              : 'exercise-form-tokens-error'
          }
        >
          <legend className="adm-exercise-form__legend">
            {EXERCISE_FORM.tokens} (2–100) *
          </legend>
          <p className="adm-exercise-form__hint">
            Thứ tự trong form là thứ tự đúng của câu.
          </p>
          <ol className="adm-exercise-form__list">
            {value.tokens.map((token, index) => {
              const errorId = `exercise-form-token-${token.id}-error`;
              return (
                <li className="adm-exercise-form__row" key={token.id}>
                  <span className="adm-exercise-form__index" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div className="adm-exercise-form__control">
                    <input
                      className="adm-input"
                      type="text"
                      id={`exercise-form-token-${token.id}`}
                      value={token.text}
                      maxLength={MAX_TEXT}
                      aria-label={`${EXERCISE_FORM.tokens} ${index + 1}`}
                      disabled={disabled}
                      onChange={(event) =>
                        updateTokenText(token.id, event.target.value)
                      }
                      {...ariaFor(errorId, fieldErrors)}
                    />
                    <FieldError id={errorId} message={fieldErrors[errorId]} />
                  </div>
                  <div className="adm-exercise-form__row-actions">
                    <button
                      className="adm-btn adm-btn--ghost adm-btn--sm"
                      type="button"
                      aria-label={`Đưa mảnh ${index + 1} lên`}
                      disabled={disabled || index === 0}
                      onClick={() => moveToken(index, 'up')}
                    >
                      {EXERCISE_FORM.moveUp}
                    </button>
                    <button
                      className="adm-btn adm-btn--ghost adm-btn--sm"
                      type="button"
                      aria-label={`Đưa mảnh ${index + 1} xuống`}
                      disabled={disabled || index === value.tokens.length - 1}
                      onClick={() => moveToken(index, 'down')}
                    >
                      {EXERCISE_FORM.moveDown}
                    </button>
                    <button
                      className="adm-btn adm-btn--ghost adm-btn--sm"
                      type="button"
                      aria-label={`Xoá mảnh ${index + 1}`}
                      disabled={disabled}
                      onClick={() => removeToken(token.id)}
                    >
                      {EXERCISE_FORM.remove}
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          <FieldError
            id="exercise-form-tokens-error"
            message={fieldErrors['exercise-form-tokens-error']}
          />
          <button
            className="adm-btn adm-btn--outline adm-btn--sm"
            id="exercise-form-add-token"
            type="button"
            disabled={disabled || value.tokens.length >= MAX_TOKENS}
            onClick={addToken}
          >
            Thêm mảnh
          </button>
        </fieldset>
      ) : null}

      {value.type === 'speaking_repeat' ? (
        <div className="adm-field">
          <label className="adm-field__label" htmlFor="exercise-form-reference">
            {EXERCISE_FORM.referenceText}
          </label>
          <input
            className="adm-input"
            id="exercise-form-reference"
            name="referenceText"
            type="text"
            maxLength={MAX_TEXT}
            disabled={disabled}
            value={value.referenceText}
            onChange={(event) => {
              setValue((current) => ({
                ...current,
                referenceText: event.target.value,
              }));
              clearFieldError('exercise-form-reference-error');
            }}
            {...ariaFor('exercise-form-reference-error', fieldErrors)}
          />
          <FieldError
            id="exercise-form-reference-error"
            message={fieldErrors['exercise-form-reference-error']}
          />
        </div>
      ) : null}

      {formError !== null ? (
        <p className="adm-form-error" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="adm-exercise-form__actions">
        <button
          className="adm-btn adm-btn--primary"
          type="submit"
          disabled={disabled}
        >
          {pending
            ? isEdit
              ? 'Đang lưu…'
              : 'Đang tạo…'
            : isEdit
              ? EXERCISE_FORM.submitRevision
              : EXERCISE_FORM.submitCreate}
        </button>
      </div>
    </form>
  );
}
