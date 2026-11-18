/**
 * Giá trị thuần (không Zod) cho form và lịch sử câu hỏi — client component
 * được import module này mà không kéo Zod vào bundle (frontend/AGENTS.md).
 */

export const QUESTION_TYPE_VALUES = [
  'mcq',
  'true_false',
  'fill_blank',
  'arrange_sentence',
] as const;

export const QUESTION_SKILL_VALUES = [
  'listening',
  'reading',
  'writing',
  'speaking',
] as const;

export const QUESTION_STATUS_VALUES = [
  'draft',
  'published',
  'archived',
] as const;

export const REVIEW_DECISION_VALUES = [
  'approved',
  'changes_requested',
  'rejected',
] as const;

export type QuestionFormType =
  'mcq' | 'true_false' | 'fill_blank' | 'arrange_sentence';

export type QuestionOptionValue = { id: string; text: string };
export type QuestionTokenValue = { id: string; text: string };

export type QuestionFormValue = {
  type: QuestionFormType;
  skill: 'listening' | 'reading' | 'writing' | 'speaking';
  levelId: number | '';
  difficulty: '' | '1' | '2' | '3';
  content: string;
  options: QuestionOptionValue[];
  correctOptionId: string;
  trueFalse: '' | 'true' | 'false';
  acceptedTexts: string[];
  caseSensitive: boolean;
  tokens: QuestionTokenValue[];
  explanation: string;
  objective: string;
  tags: string[];
  audioId: number | '';
  imageId: number | '';
};

export type QuestionPayload = {
  type: QuestionFormType;
  skill: QuestionFormValue['skill'];
  levelId: number;
  content: string;
  answers: Record<string, unknown>;
  correctAnswer: Record<string, unknown>;
  explanation: string | null;
  objective: string | null;
  difficulty: number | null;
  audioId: number | null;
  imageId: number | null;
  tags: string[];
};

export type QuestionFormErrors = Record<string, string>;

export type QuestionValidationResult =
  | { ok: true; payload: QuestionPayload }
  | { ok: false; errors: QuestionFormErrors; order: string[] };

export const QUESTION_MAX_TEXT = 4_096;
export const QUESTION_MAX_OBJECTIVE = 500;
export const QUESTION_MAX_TAGS = 10;
export const QUESTION_MAX_TAG = 40;
export const QUESTION_MIN_OPTIONS = 2;
export const QUESTION_MAX_OPTIONS = 100;
export const QUESTION_MIN_ACCEPTED = 1;
export const QUESTION_MAX_ACCEPTED = 100;
export const QUESTION_MIN_TOKENS = 2;
export const QUESTION_MAX_TOKENS = 100;

export const QUESTION_TYPE_OPTIONS: ReadonlyArray<{
  value: QuestionFormType;
  label: string;
}> = [
  { value: 'mcq', label: 'Trắc nghiệm' },
  { value: 'true_false', label: 'Đúng/Sai' },
  { value: 'fill_blank', label: 'Điền từ' },
  { value: 'arrange_sentence', label: 'Sắp xếp câu' },
];

export const QUESTION_SKILL_OPTIONS: ReadonlyArray<{
  value: QuestionFormValue['skill'];
  label: string;
}> = [
  { value: 'listening', label: 'Nghe hiểu' },
  { value: 'reading', label: 'Đọc hiểu' },
  { value: 'writing', label: 'Viết' },
  { value: 'speaking', label: 'Nói' },
];

export const QUESTION_STATUS_OPTIONS: ReadonlyArray<{
  value: 'draft' | 'published' | 'archived';
  label: string;
}> = [
  { value: 'draft', label: 'Bản nháp' },
  { value: 'published', label: 'Đã xuất bản' },
  { value: 'archived', label: 'Lưu trữ' },
];

export const QUESTION_DIFFICULTY_OPTIONS: ReadonlyArray<{
  value: QuestionFormValue['difficulty'];
  label: string;
}> = [
  { value: '', label: 'Chưa chọn' },
  { value: '1', label: 'Dễ' },
  { value: '2', label: 'Trung bình' },
  { value: '3', label: 'Khó' },
];

export type QuestionTagSuggestion = { slug: string; name: string };

/** Nguồn dựng form khi sửa: các field đã materialize trên row Question. */
export type QuestionInitialSource = {
  type: string;
  skill: string;
  levelId: number;
  content: string;
  answers: Record<string, unknown>;
  correctAnswer: Record<string, unknown>;
  explanation: string | null;
  objective: string | null;
  difficulty: number | null;
  audioId: number | null;
  imageId: number | null;
  tags: ReadonlyArray<{ name: string }>;
};

let fallbackId = 0;

export function nextStableId(prefix: 'opt' | 'tok'): string {
  fallbackId += 1;
  return `${prefix}-${Date.now().toString(36)}-${fallbackId}`;
}

export function emptyQuestionFormValue(
  levelId: number | '' = '',
): QuestionFormValue {
  return {
    type: 'mcq',
    skill: 'reading',
    levelId,
    difficulty: '',
    content: '',
    options: [
      { id: nextStableId('opt'), text: '' },
      { id: nextStableId('opt'), text: '' },
    ],
    correctOptionId: '',
    trueFalse: '',
    acceptedTexts: [''],
    caseSensitive: false,
    tokens: [
      { id: nextStableId('tok'), text: '' },
      { id: nextStableId('tok'), text: '' },
    ],
    explanation: '',
    objective: '',
    tags: [],
    audioId: '',
    imageId: '',
  };
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Prefill form từ row `Question` (bản live). Contract chi tiết M4.1a không trả
 * snapshot của revision nên đây là nguồn đúng duy nhất; câu đã publish còn bản
 * sửa chờ duyệt sẽ hiện nội dung đang live và tác giả tạo revision mới từ đó.
 */
export function questionPrefillFromRow(
  source: QuestionInitialSource,
): QuestionFormValue {
  const form = emptyQuestionFormValue(source.levelId);
  form.type = (
    QUESTION_TYPE_OPTIONS.some((option) => option.value === source.type)
      ? source.type
      : 'mcq'
  ) as QuestionFormType;
  form.skill =
    QUESTION_SKILL_OPTIONS.find((option) => option.value === source.skill)
      ?.value ?? 'reading';
  form.levelId = source.levelId;
  form.difficulty =
    source.difficulty === 1 ||
    source.difficulty === 2 ||
    source.difficulty === 3
      ? (String(source.difficulty) as QuestionFormValue['difficulty'])
      : '';
  form.content = source.content;
  form.explanation = source.explanation ?? '';
  form.objective = source.objective ?? '';
  form.audioId = source.audioId ?? '';
  form.imageId = source.imageId ?? '';
  form.tags = source.tags.map((tag) => tag.name);

  const answers = readRecord(source.answers);
  const correct = readRecord(source.correctAnswer);
  if (source.type === 'mcq') {
    const options = readArray(answers.options).map((option) => {
      const record = readRecord(option);
      return {
        id: readString(record.id) || nextStableId('opt'),
        text: readString(record.text),
      };
    });
    if (options.length >= 2) form.options = options;
    form.correctOptionId = readString(correct.optionId);
  } else if (source.type === 'true_false') {
    form.trueFalse =
      correct.value === true ? 'true' : correct.value === false ? 'false' : '';
  } else if (source.type === 'fill_blank') {
    const accepted = readArray(correct.acceptedTexts)
      .map((value) => readString(value))
      .filter((value) => value.length > 0);
    form.acceptedTexts = accepted.length > 0 ? accepted : [''];
    form.caseSensitive = correct.caseSensitive === true;
  } else if (source.type === 'arrange_sentence') {
    const tokens = readArray(answers.tokens).map((token) => {
      const record = readRecord(token);
      return {
        id: readString(record.id) || nextStableId('tok'),
        text: readString(record.text),
      };
    });
    if (tokens.length >= 2) {
      const order = readArray(correct.tokenIds)
        .map((value) => readString(value))
        .filter((value) => value.length > 0);
      const byId = new Map(tokens.map((token) => [token.id, token]));
      const ordered = order
        .map((id) => byId.get(id))
        .filter((token): token is QuestionTokenValue => token !== undefined);
      form.tokens = ordered.length === tokens.length ? ordered : tokens;
    }
  }
  return form;
}

function trimmedOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Dựng payload canonical; client chỉ kiểm hình dạng, backend là nguồn đúng. */
export function questionFormToPayload(
  value: QuestionFormValue,
): QuestionValidationResult {
  const errors: QuestionFormErrors = {};
  const order: string[] = [];

  const fail = (field: string, message: string) => {
    if (!errors[field]) {
      errors[field] = message;
      order.push(field);
    }
  };

  if (value.levelId === '') fail('levelId', 'Chọn cấp độ HSK.');
  if (value.content.trim().length === 0)
    fail('content', 'Nhập nội dung câu hỏi.');
  if (value.content.length > QUESTION_MAX_TEXT)
    fail('content', `Nội dung tối đa ${QUESTION_MAX_TEXT} ký tự.`);
  if (value.explanation.length > QUESTION_MAX_TEXT)
    fail('explanation', `Giải thích tối đa ${QUESTION_MAX_TEXT} ký tự.`);
  if (value.objective.length > QUESTION_MAX_OBJECTIVE)
    fail('objective', `Mục tiêu tối đa ${QUESTION_MAX_OBJECTIVE} ký tự.`);
  if (value.tags.length > QUESTION_MAX_TAGS)
    fail('tags', `Tối đa ${QUESTION_MAX_TAGS} chủ đề.`);
  for (const tag of value.tags) {
    if (tag.trim().length === 0 || tag.trim().length > QUESTION_MAX_TAG) {
      fail('tags', `Mỗi chủ đề dài 1–${QUESTION_MAX_TAG} ký tự.`);
      break;
    }
  }

  let answers: Record<string, unknown> = {};
  let correctAnswer: Record<string, unknown> = {};
  if (value.type === 'mcq') {
    const options = value.options
      .map((option) => ({ id: option.id, text: option.text.trim() }))
      .filter((option) => option.text.length > 0);
    if (options.length < QUESTION_MIN_OPTIONS)
      fail('options', `Cần ít nhất ${QUESTION_MIN_OPTIONS} lựa chọn.`);
    if (options.length > QUESTION_MAX_OPTIONS)
      fail('options', `Tối đa ${QUESTION_MAX_OPTIONS} lựa chọn.`);
    if (!options.some((option) => option.id === value.correctOptionId))
      fail('correctOptionId', 'Chọn đáp án đúng.');
    answers = { options };
    correctAnswer = { optionId: value.correctOptionId };
  } else if (value.type === 'true_false') {
    if (value.trueFalse === '') fail('trueFalse', 'Chọn Đúng hoặc Sai.');
    answers = {};
    correctAnswer = { value: value.trueFalse === 'true' };
  } else if (value.type === 'fill_blank') {
    const acceptedTexts = value.acceptedTexts
      .map((text) => text.trim())
      .filter((text) => text.length > 0);
    if (acceptedTexts.length < QUESTION_MIN_ACCEPTED)
      fail('acceptedTexts', 'Cần ít nhất một đáp án chấp nhận.');
    if (acceptedTexts.length > QUESTION_MAX_ACCEPTED)
      fail('acceptedTexts', `Tối đa ${QUESTION_MAX_ACCEPTED} đáp án.`);
    answers = {};
    correctAnswer = {
      acceptedTexts,
      ...(value.caseSensitive ? { caseSensitive: true } : {}),
    };
  } else {
    const tokens = value.tokens
      .map((token) => ({ id: token.id, text: token.text.trim() }))
      .filter((token) => token.text.length > 0);
    if (tokens.length < QUESTION_MIN_TOKENS)
      fail('tokens', `Cần ít nhất ${QUESTION_MIN_TOKENS} mảnh câu.`);
    if (tokens.length > QUESTION_MAX_TOKENS)
      fail('tokens', `Tối đa ${QUESTION_MAX_TOKENS} mảnh câu.`);
    answers = { tokens };
    correctAnswer = { tokenIds: tokens.map((token) => token.id) };
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors, order };

  return {
    ok: true,
    payload: {
      type: value.type,
      skill: value.skill,
      levelId: Number(value.levelId),
      content: value.content.trim(),
      answers,
      correctAnswer,
      explanation: trimmedOrNull(value.explanation),
      objective: trimmedOrNull(value.objective),
      difficulty: value.difficulty === '' ? null : Number(value.difficulty),
      audioId: value.audioId === '' ? null : Number(value.audioId),
      imageId: value.imageId === '' ? null : Number(value.imageId),
      tags: value.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0),
    },
  };
}

/**
 * Map `error.details.path` của backend (422) về ô của form (TL-20 pattern).
 * Trả `null` khi không khớp ô nào để UI hiện lỗi chung.
 */
export function fieldForServerPath(path: string | undefined): string | null {
  if (!path) return null;
  if (path.startsWith('content.options') || path.startsWith('answers.options'))
    return 'options';
  if (path === 'content') return 'content';
  if (
    path.startsWith('answers.tokens') ||
    path.startsWith('correctAnswer.tokenIds')
  )
    return 'tokens';
  if (
    path.startsWith('answer.acceptedTexts') ||
    path.startsWith('correctAnswer.acceptedTexts')
  )
    return 'acceptedTexts';
  if (path === 'correctAnswer.optionId') return 'correctOptionId';
  if (path === 'correctAnswer.value') return 'trueFalse';
  if (path === 'levelId') return 'levelId';
  if (path === 'difficulty') return 'difficulty';
  if (path === 'explanation') return 'explanation';
  if (path === 'objective') return 'objective';
  if (path.startsWith('tags')) return 'tags';
  if (path === 'audioId') return 'audio';
  if (path === 'imageId') return 'image';
  if (path === 'skill') return 'skill';
  if (path === 'type') return 'type';
  return null;
}

/** Nhãn "Bởi" trong lịch sử phiên bản (TL-90). */
export function questionActorLabel(
  author: { id: number; name: string | null } | null,
  sessionAdminId: number,
): string {
  if (author === null) return '—';
  if (author.id === sessionAdminId) return 'Bạn';
  return author.name ?? `Quản trị viên #${author.id}`;
}
