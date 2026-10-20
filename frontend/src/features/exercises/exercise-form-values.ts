/**
 * M5.1b1 Pha B — interface dùng chung của form bài tập (TL-18, TL-19, Q96).
 *
 * Module thuần (không import gì) để client component dùng mà không kéo Zod
 * vào bundle (frontend/AGENTS.md, `client-bundle-guard`) và để page server
 * `import type` an toàn. Nhãn tiếng Việt lấy từ `admin-labels.ts` (cũng là
 * module thuần), không đặt chữ trong file này.
 */

export type ExerciseFormType =
  | 'mcq'
  | 'listening_choice'
  | 'fill_blank'
  | 'arrange_sentence'
  | 'speaking_repeat';

export type ExerciseOptionValue = { id: string; text: string };
export type ExerciseTokenValue = { id: string; text: string };

/** State của form (chuỗi như ô nhập; chuyển kiểu khi submit). */
export type ExerciseFormValue = {
  type: ExerciseFormType;
  prompt: string;
  explanation: string;
  /** Chuỗi số của ô "Thứ tự" (1..1 000 000), kiểm lúc submit. */
  orderIndex: string;
  /** TL-19: 2–100 lựa chọn cho mcq/listening_choice. */
  options: ExerciseOptionValue[];
  /** TL-19: id lựa chọn đúng; '' = chưa chọn (bắt buộc 1). */
  correctOptionId: string;
  /** TL-19: 1–100 đáp án chấp nhận cho fill_blank. */
  acceptedTexts: string[];
  /** TL-19: "Phân biệt chữ hoa/thường". */
  caseSensitive: boolean;
  /** TL-19: 2–100 mảnh câu cho arrange_sentence (thứ tự soạn = thứ tự đúng). */
  tokens: ExerciseTokenValue[];
  /** TL-19: id token theo thứ tự đúng (bằng đúng tập id trong `tokens`). */
  tokenOrder: string[];
  /**
   * TL-24 (X1): thứ tự HIỂN THỊ đã lưu trong `content.tokens` của bản sửa
   * trước; chỉ dùng khi sửa để giữ nguyên thứ tự hiển thị cũ. Tạo mới: `[]`.
   */
  tokenDisplayOrder: string[];
  /** TL-19: "Câu mẫu" tuỳ chọn cho speaking_repeat. */
  referenceText: string;
  /** listening_choice: Media audio ready/live; null = chưa chọn. */
  mediaId: number | null;
};

/** Tuỳ chọn khi dựng payload (X1). */
export type ExercisePayloadOptions = {
  /** Thứ tự hiển thị `content.tokens` đã lưu (chỉ arrange_sentence, khi sửa). */
  previousDisplayTokenIds?: readonly string[];
  /** Nguồn ngẫu nhiên [0, maxExclusive); mặc định `crypto.getRandomValues`. */
  randomInt?: (maxExclusive: number) => number;
};

/** Payload canonical gửi backend (khớp `LessonExerciseAuthoringValue`). */
export type ExercisePayload = {
  type: ExerciseFormType;
  prompt: string;
  content: Record<string, unknown>;
  answer: Record<string, unknown>;
  explanation: string | null;
  orderIndex: number;
  mediaId: number | null;
};

/** Lựa chọn audio của form (server lọc type=audio/ready/active, limit 100). */
export type ExerciseMediaOption = { id: number; filename: string | null };
/** Lựa chọn bài học khi tạo không có `?lessonId=`. */
export type ExerciseLessonOption = {
  id: number;
  title: string;
  levelCode: string;
};
/** Chủ đề chưa lưu trữ của bài học đã chọn. */
export type ExerciseTopicOption = { id: number; title: string };

export type ExerciseFormCreateProps = {
  mode: 'create';
  /** Đã lọc server-side: GET lessons limit 100, theo cấp độ/thứ tự. */
  lessons: ExerciseLessonOption[];
  /** Chủ đề chưa lưu trữ của bài trong `?lessonId=`. */
  topics: ExerciseTopicOption[];
  audio: ExerciseMediaOption[];
  initialLessonId?: number | null;
  /**
   * X11: tên bài học lấy từ context trang (`?lessonId=`), dùng cho ô Bài học
   * chỉ đọc thay vì suy from danh sách lessons hoặc "Bài học #id".
   */
  initialLessonTitle?: string | null;
  /** '/api/admin/exercises'. */
  submitPath: string;
  onSaved: (exerciseId: number) => void;
};

export type ExerciseFormEditProps = {
  mode: 'edit';
  /** Prefill TL-15 từ snapshot bản sửa mới nhất, fallback live. */
  initial: ExerciseFormValue;
  /** Bài học/chủ đề chỉ đọc khi sửa (TL-18). */
  lessonTitle: string;
  topicTitle: string | null;
  /** Bài đã lưu trữ: khoá toàn bộ form, mọi mutation 409. */
  archived: boolean;
  audio: ExerciseMediaOption[];
  /** '/api/admin/exercises/:id/revisions'. */
  submitPath: string;
  onSaved: () => void;
};

export type ExerciseFormProps = ExerciseFormCreateProps | ExerciseFormEditProps;

/** X1: số nguyên ngẫu nhiên [0, maxExclusive) bằng crypto.getRandomValues. */
function cryptoRandomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) return 0;
  const buffer = new Uint32Array(1);
  // Loại phần dư để phân phối đều (modulo bias).
  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
  let value = 0;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0] ?? 0;
  } while (value >= limit);
  return value % maxExclusive;
}

/** Fisher–Yates với nguồn ngẫu nhiên tiêm được (unit test). */
function shuffleIds(
  ids: readonly string[],
  randomInt: (maxExclusive: number) => number,
): string[] {
  const result = [...ids];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    const current = result[index];
    const other = result[swapIndex];
    if (current === undefined || other === undefined) continue;
    result[index] = other;
    result[swapIndex] = current;
  }
  return result;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Y4 (TL-24): thứ tự hiển thị phải khác thứ tự đáp án **theo chữ đã trim**.
 * Chữ trùng nhau (ví dụ 好/好) nên so id không đủ; chỉ khi mọi mảnh cùng một
 * chữ mới quay về so theo id (không còn cách nào khác để phân biệt).
 */
function sameDisplaySequence(
  displayIds: readonly string[],
  answerIds: readonly string[],
  textById: ReadonlyMap<string, string>,
): boolean {
  const answerTexts = answerIds.map((id) => textById.get(id) ?? '');
  const allSameText =
    answerTexts.length > 0 &&
    answerTexts.every((text) => text === answerTexts[0]);
  if (allSameText) return sameOrder(displayIds, answerIds);
  const displayTexts = displayIds.map((id) => textById.get(id) ?? '');
  return sameOrder(displayTexts, answerTexts);
}

/**
 * X1: thứ tự hiển thị cho `content.tokens`.
 * - Giữ thứ tự hiển thị đã lưu của các mảnh còn lại; mảnh mới nối cuối.
 * - Kết quả trùng thứ tự đáp án theo chữ (dữ liệu cũ hoặc trùng chữ) → xáo
 *   lại tới khi khác (n ≥ 2); luôn giữ đúng tập id của đáp án.
 */
function arrangeDisplayIds(
  answerIds: readonly string[],
  previousDisplayIds: readonly string[],
  textById: ReadonlyMap<string, string>,
  randomInt: (maxExclusive: number) => number,
): string[] {
  const answerSet = new Set(answerIds);
  const seen = new Set<string>();
  const preserved: string[] = [];
  for (const id of previousDisplayIds) {
    if (!answerSet.has(id) || seen.has(id)) continue;
    seen.add(id);
    preserved.push(id);
  }
  const appended = answerIds.filter((id) => !seen.has(id));
  let display = [...preserved, ...appended];
  if (
    display.length < 2 ||
    !sameDisplaySequence(display, answerIds, textById)
  ) {
    return display;
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    display = shuffleIds(display, randomInt);
    if (!sameDisplaySequence(display, answerIds, textById)) return display;
  }
  // Nguồn ngẫu nhiên suy biến (mọi lần cùng kết quả): xoay vòng để chắc chắn
  // thứ tự hiển thị khác thứ tự đáp án (id khác; chữ khác nếu không phải mọi
  // mảnh cùng một chữ).
  return [...answerIds.slice(1), answerIds[0]].filter(
    (id): id is string => id !== undefined,
  );
}

/**
 * Y3: danh sách id theo thứ tự `content.tokens` của payload vừa gửi, để form
 * sửa nhớ đúng thứ tự hiển thị vừa lưu cho lần gửi tiếp theo.
 */
export function payloadTokenDisplayIds(payload: ExercisePayload): string[] {
  if (payload.type !== 'arrange_sentence') return [];
  const tokens = payload.content.tokens;
  if (!Array.isArray(tokens)) return [];
  const ids: string[] = [];
  for (const entry of tokens) {
    if (isRecord(entry) && typeof entry.id === 'string') ids.push(entry.id);
  }
  return ids;
}

/**
 * TL-19: chuyển state form → payload canonical theo từng loại.
 * - mcq/listening_choice: content `{ options }`, answer `{ optionId }`.
 * - fill_blank: content `{}`, answer `{ acceptedTexts, caseSensitive? }`.
 * - arrange_sentence: content `{ tokens }`, answer `{ tokenIds }` theo `tokenOrder`.
 * - speaking_repeat: content `{ referenceText? }`, answer `{}`.
 * Chuỗi trim như backend; `explanation` rỗng → null; `mediaId` chỉ cho
 * listening_choice, còn lại null.
 */
export function exerciseFormToPayload(
  value: ExerciseFormValue,
  options: ExercisePayloadOptions = {},
): ExercisePayload {
  const explanation = value.explanation.trim();
  let content: Record<string, unknown> = {};
  let answer: Record<string, unknown> = {};
  switch (value.type) {
    case 'mcq':
    case 'listening_choice':
      content = {
        options: value.options.map((option) => ({
          id: option.id,
          text: option.text.trim(),
        })),
      };
      answer = { optionId: value.correctOptionId };
      break;
    case 'fill_blank':
      answer = {
        acceptedTexts: value.acceptedTexts.map((text) => text.trim()),
        // Backend nhận `caseSensitive` optional; chỉ gửi khi bật để payload
        // gọn và giữ đúng canonical của dữ liệu cũ.
        ...(value.caseSensitive ? { caseSensitive: true } : {}),
      };
      break;
    case 'arrange_sentence': {
      // TL-24 (X1): người soạn nhập theo thứ tự đúng (`answer.tokenIds`), còn
      // `content.tokens` lưu thứ tự hiển thị khác thứ tự đáp án.
      const byId = new Map(value.tokens.map((token) => [token.id, token]));
      const answerIds =
        value.tokenOrder.length === value.tokens.length &&
        new Set(value.tokenOrder).size === value.tokens.length &&
        value.tokenOrder.every((id) => byId.has(id))
          ? [...value.tokenOrder]
          : value.tokens.map((token) => token.id);
      const displayIds = arrangeDisplayIds(
        answerIds,
        options.previousDisplayTokenIds ?? value.tokenDisplayOrder,
        new Map(
          value.tokens.map((token) => [token.id, token.text.trim()] as const),
        ),
        options.randomInt ?? cryptoRandomInt,
      );
      content = {
        tokens: displayIds.map((id) => {
          const token = byId.get(id);
          return { id, text: token === undefined ? '' : token.text.trim() };
        }),
      };
      answer = { tokenIds: answerIds };
      break;
    }
    case 'speaking_repeat': {
      const referenceText = value.referenceText.trim();
      if (referenceText !== '') content = { referenceText };
      break;
    }
  }
  return {
    type: value.type,
    prompt: value.prompt.trim(),
    content,
    answer,
    explanation: explanation === '' ? null : explanation,
    orderIndex: Number(value.orderIndex),
    mediaId: value.type === 'listening_choice' ? value.mediaId : null,
  };
}

/** Giá trị mặc định an toàn: mcq rỗng, không đoán nội dung của loại khác. */
export function emptyExerciseFormValue(): ExerciseFormValue {
  return {
    type: 'mcq',
    prompt: '',
    explanation: '',
    orderIndex: '',
    options: [],
    correctOptionId: '',
    acceptedTexts: [],
    caseSensitive: false,
    tokens: [],
    tokenOrder: [],
    tokenDisplayOrder: [],
    referenceText: '',
    mediaId: null,
  };
}

const EXERCISE_FORM_TYPE_VALUES = [
  'mcq',
  'listening_choice',
  'fill_blank',
  'arrange_sentence',
  'speaking_repeat',
] as const satisfies readonly ExerciseFormType[];

export function isExerciseFormType(value: unknown): value is ExerciseFormType {
  return EXERCISE_FORM_TYPE_VALUES.some((type) => type === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readExplanation(value: unknown): string | undefined {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : undefined;
}

function readMediaId(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 2_147_483_647
    ? value
    : undefined;
}

function readOptions(value: unknown): ExerciseOptionValue[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 100) {
    return null;
  }
  const ids = new Set<string>();
  const options: ExerciseOptionValue[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== 'string' ||
      entry.id === '' ||
      typeof entry.text !== 'string' ||
      ids.has(entry.id)
    ) {
      return null;
    }
    ids.add(entry.id);
    options.push({ id: entry.id, text: entry.text });
  }
  return options;
}

function readTokens(value: unknown): ExerciseTokenValue[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 100) {
    return null;
  }
  const ids = new Set<string>();
  const tokens: ExerciseTokenValue[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== 'string' ||
      entry.id === '' ||
      typeof entry.text !== 'string' ||
      ids.has(entry.id)
    ) {
      return null;
    }
    ids.add(entry.id);
    tokens.push({ id: entry.id, text: entry.text });
  }
  return tokens;
}

function readTokenDisplayOrder(
  rawTokens: unknown,
  answerIds: readonly string[],
): string[] {
  if (!Array.isArray(rawTokens)) return [];
  const answerSet = new Set(answerIds);
  const seen = new Set<string>();
  const display: string[] = [];
  for (const entry of rawTokens) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue;
    if (!answerSet.has(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    display.push(entry.id);
  }
  if (display.length !== answerIds.length) return [];
  return display;
}

function readAcceptedTexts(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    return null;
  }
  const texts: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return null;
    texts.push(entry);
  }
  return texts;
}

/**
 * Đọc một candidate (snapshot hoặc live) theo đúng shape canonical của
 * backend. Trả null khi chỉ cần một trường sai kiểu để page biết fallback,
 * không đoán giá trị.
 */
function formValueFromCandidate(candidate: unknown): ExerciseFormValue | null {
  if (!isRecord(candidate)) return null;
  const type = candidate.type;
  if (!isExerciseFormType(type)) return null;
  if (typeof candidate.prompt !== 'string') return null;
  const orderIndex = candidate.orderIndex;
  if (
    typeof orderIndex !== 'number' ||
    !Number.isInteger(orderIndex) ||
    orderIndex < 1 ||
    orderIndex > 1_000_000
  ) {
    return null;
  }
  const content = candidate.content;
  const answer = candidate.answer;
  if (!isRecord(content) || !isRecord(answer)) return null;
  const explanation = readExplanation(candidate.explanation);
  if (explanation === undefined) return null;
  const mediaId = readMediaId(candidate.mediaId);
  if (mediaId === undefined) return null;

  const value: ExerciseFormValue = {
    ...emptyExerciseFormValue(),
    type,
    prompt: candidate.prompt,
    explanation,
    orderIndex: String(orderIndex),
    mediaId: type === 'listening_choice' ? mediaId : null,
  };

  switch (type) {
    case 'mcq':
    case 'listening_choice': {
      const options = readOptions(content.options);
      if (options === null) return null;
      const optionId = answer.optionId;
      if (
        typeof optionId !== 'string' ||
        !options.some((option) => option.id === optionId)
      ) {
        return null;
      }
      value.options = options;
      value.correctOptionId = optionId;
      return value;
    }
    case 'fill_blank': {
      const acceptedTexts = readAcceptedTexts(answer.acceptedTexts);
      if (acceptedTexts === null) return null;
      if (
        answer.caseSensitive !== undefined &&
        typeof answer.caseSensitive !== 'boolean'
      ) {
        return null;
      }
      value.acceptedTexts = acceptedTexts;
      value.caseSensitive = answer.caseSensitive === true;
      return value;
    }
    case 'arrange_sentence': {
      const tokens = readTokens(content.tokens);
      if (tokens === null) return null;
      const rawTokenIds = answer.tokenIds;
      if (!Array.isArray(rawTokenIds) || rawTokenIds.length !== tokens.length) {
        return null;
      }
      const byId = new Map(tokens.map((token) => [token.id, token]));
      const seen = new Set<string>();
      const tokenOrder: string[] = [];
      for (const entry of rawTokenIds) {
        if (typeof entry !== 'string' || seen.has(entry) || !byId.has(entry)) {
          return null;
        }
        seen.add(entry);
        tokenOrder.push(entry);
      }
      const orderedTokens = tokenOrder.map((id) => {
        const token = byId.get(id);
        // Đã kiểm byId.has ở trên; nhánh này chỉ để TypeScript thu hẹp kiểu.
        return token ?? { id, text: '' };
      });
      value.tokens = orderedTokens;
      value.tokenOrder = tokenOrder;
      value.tokenDisplayOrder = readTokenDisplayOrder(
        content.tokens,
        tokenOrder,
      );
      return value;
    }
    case 'speaking_repeat': {
      const referenceText = content.referenceText;
      if (referenceText !== undefined && typeof referenceText !== 'string') {
        return null;
      }
      value.referenceText =
        typeof referenceText === 'string' ? referenceText : '';
      return value;
    }
  }
}

/**
 * TL-15: prefill từ snapshot bản sửa mới nhất; snapshot không đọc được
 * (sai shape/loại lạ) → dựng lại từ dữ liệu live của bài tập. Không đoán.
 */
export function exercisePrefillFromSnapshot(
  snapshot: unknown,
  live: unknown,
): ExerciseFormValue {
  return (
    formValueFromCandidate(snapshot) ??
    formValueFromCandidate(live) ??
    emptyExerciseFormValue()
  );
}
