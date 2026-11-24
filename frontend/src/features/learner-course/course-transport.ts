import type { CourseSummary } from './course-model';

// Zod-free BFF calls of the course screens (C3b-UI). `status` 0 is a network
// failure or an unreadable 2xx body.

export type CourseCall<T> =
  { ok: true; data: T } | { ok: false; status: number };

const REQUEST_TIMEOUT_MS = 15_000;

type Fetcher = typeof fetch;

export function createCourseTransport(
  fetcher: Fetcher = (...args) => fetch(...args),
) {
  async function call<T>(
    url: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: unknown,
  ): Promise<CourseCall<T>> {
    let response: Response;
    try {
      response = await fetcher(url, {
        method,
        headers:
          body === undefined
            ? { accept: 'application/json' }
            : {
                accept: 'application/json',
                'content-type': 'application/json',
              },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, status: 0 };
    }
    if (!response.ok) return { ok: false, status: response.status };
    if (response.status === 204) return { ok: true, data: null as T };
    const payload: unknown = await response.json().catch(() => null);
    const data =
      typeof payload === 'object' && payload !== null && 'data' in payload
        ? (payload as { data: unknown }).data
        : undefined;
    if (data === undefined) return { ok: false, status: 0 };
    return { ok: true, data: data as T };
  }

  const enrollment = (code: string) =>
    `/api/learner/courses/${encodeURIComponent(code)}/enrollment`;

  return {
    list: () => call<{ courses: CourseSummary[] }>('/api/learner/courses'),
    enroll: (code: string) => call<unknown>(enrollment(code), 'POST'),
    leave: (code: string) => call<null>(enrollment(code), 'DELETE'),
    setCurrent: (code: string) =>
      call<unknown>('/api/learner/current-course', 'PUT', { courseCode: code }),
  };
}

export type CourseTransport = ReturnType<typeof createCourseTransport>;
