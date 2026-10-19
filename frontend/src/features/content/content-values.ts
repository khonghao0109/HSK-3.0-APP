/**
 * Giá trị/type dùng chung giữa server và client của feature content (M5.1a).
 * Module thuần (không import gì) để không kéo Zod vào client bundle
 * (frontend/AGENTS.md, client-bundle-guard) và không tạo vòng server↔client.
 */

export type WorkflowReview = {
  decision: string;
  reviewerId: number | null;
  createdAt: string;
  note?: string | null;
};

export type WorkflowRevision = {
  id: number;
  revision: number;
  authorId: number | null;
  createdAt: string;
  reviews: WorkflowReview[];
};

/** TL-13: "Bạn" khi là admin đang đăng nhập, ngược lại "Quản trị viên #<id>". */
export function actorLabel(id: number | null, sessionAdminId: number): string {
  if (id === null) return '—';
  return id === sessionAdminId ? 'Bạn' : `Quản trị viên #${id}`;
}

export type WorkflowStepState = {
  /** 1 Bản nháp · 2 Gửi duyệt · 3 Đã duyệt · 4 Đã xuất bản. */
  step: 1 | 2 | 3 | 4;
  /** Mô tả thay cho mô tả mặc định của bước hiện tại (TL-16). */
  note: string | null;
  /** Mốc và người của sự kiện gần nhất cho thẻ "Trạng thái hiện tại". */
  updatedAt: string | null;
  updatedById: number | null;
};

/** S1: loại nội dung để chuẩn hoá đúng bộ trường backend so sánh. */
export type ContentEntityKind = 'lesson' | 'topic';

/** S1: nội dung live + snapshot bản sửa mới nhất để nhận biết đã xuất bản. */
export type ContentComparison = {
  entity: ContentEntityKind;
  live: unknown;
  snapshot: unknown;
};

/**
 * S1: chuẩn hoá nội dung live đúng cách backend tạo snapshot
 * (`cms.service.ts` lessonSnapshot/topicSnapshot): title/subtitle/slug trim,
 * description/subtitle rỗng → null, slug lowercase. Thiếu/sai kiểu → null
 * (coi như không khớp, không đoán).
 */
function liveSnapshotOf(
  entity: ContentEntityKind,
  live: unknown,
): Record<string, unknown> | null {
  if (typeof live !== 'object' || live === null) return null;
  const value = live as Record<string, unknown>;
  if (entity === 'lesson') {
    const description = value.description;
    if (
      typeof value.title !== 'string' ||
      typeof value.orderIndex !== 'number' ||
      typeof value.slug !== 'string' ||
      (description !== undefined &&
        description !== null &&
        typeof description !== 'string')
    ) {
      return null;
    }
    return {
      title: value.title.trim(),
      description:
        typeof description === 'string' ? description.trim() || null : null,
      orderIndex: value.orderIndex,
      slug: value.slug.trim().toLowerCase(),
    };
  }
  const subtitle = value.subtitle;
  if (
    typeof value.title !== 'string' ||
    typeof value.type !== 'string' ||
    typeof value.orderIndex !== 'number' ||
    typeof value.isPremium !== 'boolean' ||
    typeof value.isLocked !== 'boolean' ||
    (subtitle !== undefined &&
      subtitle !== null &&
      typeof subtitle !== 'string')
  ) {
    return null;
  }
  return {
    title: value.title.trim(),
    subtitle: typeof subtitle === 'string' ? subtitle.trim() || null : null,
    type: value.type,
    content: value.content === undefined ? null : value.content,
    orderIndex: value.orderIndex,
    isPremium: value.isPremium,
    isLocked: value.isLocked,
  };
}

/**
 * S1: JSON chuẩn hoá khoá có thứ tự (như `canonical-json.ts` backend) để so
 * `content` của chủ đề: object sắp xếp khoá, array giữ nguyên thứ tự.
 */
function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return `"__${typeof value}__"`;
}

/** S1: nội dung live trùng snapshot bản sửa mới nhất (backend so canonical). */
export function contentMatchesSnapshot(comparison: ContentComparison): boolean {
  const live = liveSnapshotOf(comparison.entity, comparison.live);
  if (live === null) return false;
  if (typeof comparison.snapshot !== 'object' || comparison.snapshot === null) {
    return false;
  }
  return canonicalJson(live) === canonicalJson(comparison.snapshot);
}

/**
 * TL-16: bước hiện tại tính từ dữ liệu sẵn có (status, publishedAt, bản sửa
 * mới nhất + đánh giá mới nhất). S1: bước 4 khi publishedAt ≥ createdAt bản
 * sửa mới nhất HOẶC nội dung live vẫn trùng snapshot bản sửa mới nhất
 * (publish idempotent không tạo bản sửa mới). archived → null (không vẽ 4 bước).
 */
export function workflowStep(
  status: string,
  published: { at: string | null; byId: number | null },
  latestRevision: WorkflowRevision | null,
  comparison?: ContentComparison | null,
): WorkflowStepState | null {
  if (status === 'archived') return null;
  const publishedAfterRevision =
    published.at !== null &&
    (latestRevision === null ||
      Date.parse(published.at) >= Date.parse(latestRevision.createdAt));
  const liveMatchesSnapshot =
    latestRevision !== null &&
    comparison !== undefined &&
    comparison !== null &&
    contentMatchesSnapshot(comparison);
  const isPublishedCurrent =
    status === 'published' && (publishedAfterRevision || liveMatchesSnapshot);
  if (latestRevision === null) {
    return isPublishedCurrent
      ? {
          step: 4,
          note: null,
          updatedAt: published.at,
          updatedById: published.byId,
        }
      : { step: 1, note: null, updatedAt: null, updatedById: null };
  }
  const review = latestRevision.reviews[0] ?? null;
  if (review === null) {
    return {
      step: 2,
      note: 'Chờ duyệt',
      updatedAt: latestRevision.createdAt,
      updatedById: latestRevision.authorId,
    };
  }
  if (review.decision !== 'approved') {
    return {
      step: 1,
      note: review.decision === 'rejected' ? 'Từ chối' : 'Cần sửa',
      updatedAt: review.createdAt,
      updatedById: review.reviewerId,
    };
  }
  if (isPublishedCurrent) {
    // "Sự kiện gần nhất": đánh giá có thể đến sau lần xuất bản.
    const reviewLater =
      published.at !== null &&
      Date.parse(review.createdAt) > Date.parse(published.at);
    return {
      step: 4,
      note: null,
      updatedAt: reviewLater ? review.createdAt : published.at,
      updatedById: reviewLater ? review.reviewerId : published.byId,
    };
  }
  return {
    step: 3,
    note: null,
    updatedAt: review.createdAt,
    updatedById: review.reviewerId,
  };
}

/** R9: id route là số nguyên dương int4, không có số 0 đứng đầu. */
export function parseRouteId(raw: string | undefined): number | null {
  if (raw === undefined || !/^[1-9]\d{0,9}$/u.test(raw)) return null;
  const value = Number(raw);
  return value <= 2_147_483_647 ? value : null;
}

export type TopicFormInitial = {
  title: string;
  subtitle: string | null;
  type: string;
  /** JSON đã stringify sẵn (JSON.stringify(content, null, 2)). */
  contentText: string;
  orderIndex: number;
  isPremium: boolean;
  isLocked: boolean;
};

const TOPIC_TYPE_VALUES = new Set([
  'vocabulary',
  'grammar',
  'key_text',
  'quiz',
  'ai_speaking',
]);

/**
 * R1: prefill form chủ đề từ snapshot bản sửa mới nhất (như
 * lessonPrefillFromSnapshot). Snapshot lạ → null để page fallback về live.
 */
export function topicPrefillFromSnapshot(
  snapshot: unknown,
): TopicFormInitial | null {
  if (typeof snapshot !== 'object' || snapshot === null) return null;
  const value = snapshot as Record<string, unknown>;
  if (
    typeof value.title !== 'string' ||
    typeof value.type !== 'string' ||
    !TOPIC_TYPE_VALUES.has(value.type) ||
    typeof value.orderIndex !== 'number' ||
    typeof value.isPremium !== 'boolean' ||
    typeof value.isLocked !== 'boolean' ||
    !('content' in value) ||
    (value.subtitle !== undefined &&
      value.subtitle !== null &&
      typeof value.subtitle !== 'string')
  ) {
    return null;
  }
  return {
    title: value.title,
    subtitle: typeof value.subtitle === 'string' ? value.subtitle : null,
    type: value.type,
    contentText: JSON.stringify(value.content ?? null, null, 2),
    orderIndex: value.orderIndex,
    isPremium: value.isPremium,
    isLocked: value.isLocked,
  };
}

/** R11: 401 ở thao tác client → về đăng nhập như trang server (redirectToSessionLogin). */
export const SESSION_LOGIN_PATH = '/login?reason=session';
export const FORBIDDEN_MESSAGE = 'Bạn không có quyền thực hiện thao tác này.';
