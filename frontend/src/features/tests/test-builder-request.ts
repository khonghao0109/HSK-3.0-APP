import type {
  AdminTestDetail,
  TestPatchInput,
  TestPublishReason,
  TestStructureInput,
  TestQuestionBankPage,
} from './test-values';

/**
 * Client helpers gọi BFF của trình xây dựng đề thi (TL-105). Không import
 * zod/`server-only`: chỉ `fetch` same-origin và map lỗi envelope.
 */
export type BuilderFailure = {
  status: number;
  code: string | null;
  details: Record<string, unknown> | null;
};

export type MutationResult =
  { ok: true; data: AdminTestDetail } | { ok: false; failure: BuilderFailure };

async function readFailure(response: Response): Promise<BuilderFailure> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const error =
    typeof body === 'object' && body !== null
      ? (body as { error?: unknown }).error
      : undefined;
  const record =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown; details?: unknown })
      : {};
  return {
    status: response.status,
    code: typeof record.code === 'string' ? record.code : null,
    details:
      typeof record.details === 'object' && record.details !== null
        ? (record.details as Record<string, unknown>)
        : null,
  };
}

async function mutate(
  url: string,
  method: 'POST' | 'PATCH' | 'PUT',
  body?: unknown,
): Promise<MutationResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers:
        body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      failure: { status: 503, code: null, details: null },
    };
  }
  if (!response.ok) {
    return { ok: false, failure: await readFailure(response) };
  }
  const payload = (await response.json()) as { data?: unknown };
  return { ok: true, data: payload.data as AdminTestDetail };
}

export function createTest(body: unknown): Promise<MutationResult> {
  return mutate('/api/admin/tests', 'POST', body);
}

export function patchTest(
  testId: number,
  body: TestPatchInput,
): Promise<MutationResult> {
  return mutate(`/api/admin/tests/${String(testId)}`, 'PATCH', body);
}

export function saveTestStructure(
  testId: number,
  body: TestStructureInput,
): Promise<MutationResult> {
  return mutate(`/api/admin/tests/${String(testId)}/structure`, 'PUT', body);
}

export function publishTest(
  testId: number,
  expectedUpdatedAt: string,
): Promise<MutationResult> {
  return mutate(`/api/admin/tests/${String(testId)}/publish`, 'POST', {
    expectedUpdatedAt,
  });
}

export function archiveTest(testId: number): Promise<MutationResult> {
  return mutate(`/api/admin/tests/${String(testId)}/archive`, 'POST', {});
}

export function duplicateTest(testId: number): Promise<MutationResult> {
  return mutate(`/api/admin/tests/${String(testId)}/duplicate`, 'POST', {});
}

export function publishReasons(failure: BuilderFailure): TestPublishReason[] {
  const raw = failure.details?.reasons;
  if (!Array.isArray(raw)) return [];
  const reasons: TestPublishReason[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const code = (item as { code?: unknown }).code;
    const field = (item as { field?: unknown }).field;
    if (typeof code === 'string' && typeof field === 'string') {
      reasons.push({ code, field });
    }
  }
  return reasons;
}

export type BankQuery = {
  levelId: number;
  skill: string;
  type: string;
  q: string;
  page: number;
  limit: number;
};

export async function fetchQuestionBank(
  query: BankQuery,
): Promise<
  | { ok: true; page: TestQuestionBankPage }
  | { ok: false; failure: BuilderFailure }
> {
  const params = new URLSearchParams({
    levelId: String(query.levelId),
    status: 'published',
    page: String(query.page),
    limit: String(query.limit),
  });
  if (query.skill) params.set('skill', query.skill);
  if (query.type) params.set('type', query.type);
  if (query.q.trim()) params.set('q', query.q.trim());
  let response: Response;
  try {
    response = await fetch(`/api/admin/questions?${params.toString()}`, {
      credentials: 'same-origin',
    });
  } catch {
    return { ok: false, failure: { status: 503, code: null, details: null } };
  }
  if (!response.ok) {
    return { ok: false, failure: await readFailure(response) };
  }
  const body = (await response.json()) as {
    data?: Array<{
      id: number;
      content: string;
      type: string;
      skill: string;
      levelId: number;
      difficulty: number | null;
      status: string;
    }>;
    meta?: { pagination?: TestQuestionBankPage['pagination'] };
  };
  const data = Array.isArray(body.data) ? body.data : [];
  return {
    ok: true,
    page: {
      data: data.map((question) => ({
        id: question.id,
        content: question.content,
        type: question.type,
        skill: question.skill,
        levelId: question.levelId,
        difficulty: question.difficulty,
        status: question.status,
      })),
      pagination: body.meta?.pagination ?? {
        page: query.page,
        limit: query.limit,
        total: data.length,
        totalPages: 1,
      },
    },
  };
}
