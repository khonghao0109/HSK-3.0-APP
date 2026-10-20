import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from '@playwright/test';

import { BACKEND, backendLogin } from './support/learner-fixtures';
import { queryDisposableDb } from './support/disposable-db';
import { ingestListeningAudio } from './support/listening-audio';

/**
 * M5.1b1 — trang soạn/sửa bài tập theo form từng loại (TL-18/TL-19/TL-21).
 *
 * Dữ liệu tạo ra được lưu trữ ở afterEach qua backend (không phụ thuộc page
 * còn mở), cùng kiểu S4 của M5.1a. Luồng ghi (1)–(7) chỉ chạy ở hai viewport
 * chính; (8)–(11) chạy cả 4 project.
 */

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? 'admin.frontend@example.test';
const adminPassword =
  process.env.E2E_ADMIN_PASSWORD ?? 'FrontendTest-Admin-123';

const MAIN_PROJECTS = new Set(['desktop-1440', 'mobile-390']);
const exercisesToArchive = new Set<number>();
// Y2: một audio fixture ổn định cho mọi project và mọi lượt chạy trên cùng DB;
// tìm theo tên trước, chỉ ingest với Idempotency-Key CỐ ĐỊNH khi chưa có, và
// không lưu trữ sau lượt chạy (để lần chạy sau dùng lại đúng media đó).
const AUDIO_FILENAME = 'e2e-admin-exercise.wav';
const AUDIO_IDEMPOTENCY_KEY = 'e2e-admin-exercise-audio-v1-000000000000';

type ExerciseDetailPayload = {
  data: {
    id: number;
    type: string;
    prompt: string;
    content: Record<string, unknown>;
    answer: Record<string, unknown>;
    explanation: string | null;
    version: number;
    orderIndex: number;
    status: string;
    mediaId: number | null;
    revisions: Array<{
      id: number;
      revision: number;
      snapshot: unknown;
      reviews: Array<{ decision: string }>;
    }>;
  };
};

function skipUnlessMain(testInfo: TestInfo) {
  test.skip(
    !MAIN_PROJECTS.has(testInfo.project.name),
    'luồng ghi chỉ chạy ở desktop-1440 + mobile-390',
  );
}

function suffix(testInfo: TestInfo): string {
  return testInfo.project.name.replace(/[^a-z0-9]/gu, '-');
}

function uniqueOrderIndex(): number {
  return 900_000 + (Date.now() % 90_000);
}

/**
 * Y6: orderIndex kế tiếp của level 1 đọc trực tiếp từ DB disposable — bài cũ
 * (kể cả đã lưu trữ) vẫn giữ chỗ, nên chạy lại trên cùng DB không trùng.
 */
function nextLessonOrderIndex(): number {
  const raw = queryDisposableDb(
    'SELECT COALESCE(MAX("orderIndex"), 0) FROM "Lesson" WHERE "levelId" = 1',
  );
  const current = Number(raw);
  if (!Number.isSafeInteger(current) || current < 0) {
    throw new Error(`Lesson max orderIndex không hợp lệ: "${raw}"`);
  }
  return current + 1;
}

/** Y6: tạo bài học cho test 11, tính lại orderIndex và thử lại tối đa 3 lần khi 409. */
async function createLessonForArchive(
  request: APIRequestContext,
  title: string,
  slugBase: string,
): Promise<number> {
  const token = await adminToken(request);
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await request.post(`${BACKEND}/admin/cms/lessons`, {
      headers: { authorization: `Bearer ${token}` },
      data: {
        levelId: 1,
        title,
        orderIndex: nextLessonOrderIndex(),
        slug: `${slugBase}-${attempt.toString(36)}`,
      },
    });
    if (response.status() === 201) {
      return ((await response.json()) as { data: { lesson: { id: number } } })
        .data.lesson.id;
    }
    lastError = `${response.status()} ${await response.text()}`;
    if (response.status() !== 409) break;
  }
  throw new Error(`tạo bài học lưu trữ thất bại: ${lastError}`);
}

async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Mật khẩu').fill(adminPassword);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.waitForURL(/\/(admin\/exercises|forbidden)/u);
}

async function adminToken(request: APIRequestContext): Promise<string> {
  return backendLogin(request, adminEmail, adminPassword);
}

async function backendGet<T>(
  request: APIRequestContext,
  path: string,
): Promise<T> {
  const token = await adminToken(request);
  const response = await request.get(`${BACKEND}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.ok(), `GET ${path}`).toBeTruthy();
  return (await response.json()) as T;
}

/** Bản ghi đầy đủ + snapshot bản sửa mới nhất (backend trả revisions desc). */
async function loadExerciseDetail(
  request: APIRequestContext,
  exerciseId: number,
): Promise<ExerciseDetailPayload['data']> {
  return (
    await backendGet<ExerciseDetailPayload>(
      request,
      `/admin/cms/exercises/${exerciseId}`,
    )
  ).data;
}

async function createExerciseViaBackend(
  request: APIRequestContext,
  payload: Record<string, unknown>,
): Promise<number> {
  const token = await adminToken(request);
  const response = await request.post(`${BACKEND}/admin/cms/exercises`, {
    headers: { authorization: `Bearer ${token}` },
    data: payload,
  });
  expect(response.status(), JSON.stringify(await response.json())).toBe(201);
  const body = (await response.json()) as {
    data: { exercise: { id: number } };
  };
  return body.data.exercise.id;
}

async function archiveExercises(request: APIRequestContext) {
  const ids = [...exercisesToArchive];
  exercisesToArchive.clear();
  if (ids.length === 0) return;
  const token = await adminToken(request);
  for (const id of ids) {
    const response = await request.post(
      `${BACKEND}/admin/cms/exercises/${id}/archive`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (response.ok()) continue;
    // Archive idempotent: lần hai trả 409 CONTENT_ARCHIVED.
    expect(response.status(), `archive exercise ${id}`).toBe(409);
    const payload = (await response.json()) as { error?: { code?: string } };
    expect(payload.error?.code, `archive exercise ${id}`).toBe(
      'CONTENT_ARCHIVED',
    );
  }
}

let seededLessonId = 0;
let readyAudioId = 0;

test.beforeAll(async ({ request }) => {
  const lessons = await backendGet<{
    data: Array<{ id: number; slug: string; status: string }>;
  }>(request, '/admin/cms/lessons?page=1&limit=100');
  const seeded = lessons.data.find(
    (lesson) =>
      lesson.slug === 'greetings-first-meetings' &&
      lesson.status === 'published',
  );
  const fallback = lessons.data.find((lesson) => lesson.status === 'published');
  expect(seeded ?? fallback, 'seed có lesson published').toBeTruthy();
  seededLessonId = (seeded ?? fallback)!.id;

  // Y2: dùng lại audio fixture ổn định nếu còn sống; chỉ ingest với key cố
  // định khi chưa có. Lần chạy sau trên cùng DB tìm thấy đúng media này nên
  // không tạo thêm bản ghi (kỳ vọng count = 1).
  const token = await adminToken(request);
  const media = await backendGet<{
    data: Array<{ id: number; filename: string | null }>;
  }>(
    request,
    '/admin/cms/media?page=1&limit=100&type=audio&processingStatus=ready&lifecycle=active',
  );
  const existing = media.data.find((item) => item.filename === AUDIO_FILENAME);
  readyAudioId =
    existing === undefined
      ? await ingestListeningAudio(
          request,
          BACKEND,
          token,
          AUDIO_IDEMPOTENCY_KEY,
          AUDIO_FILENAME,
        )
      : existing.id;
});

test.describe('M5.1b1 — soạn bài tập bằng form từng loại', () => {
  test.afterEach(async ({ request }) => {
    await archiveExercises(request);
  });

  test('(1) tạo trắc nghiệm từ link "Thêm bài tập" → 3 lựa chọn → trang sửa điền đúng', async ({
    page,
  }, testInfo) => {
    skipUnlessMain(testInfo);
    await loginAsAdmin(page);

    // Link từ trang bài học mở đúng ?lessonId= (TL-18).
    await page.goto(`/admin/content/lessons/${seededLessonId}`);
    await page.getByRole('link', { name: 'Thêm bài tập' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/exercises/new\\?lessonId=${seededLessonId}`, 'u'),
    );

    const prompt = `E2E trắc nghiệm ${suffix(testInfo)}`;
    await page
      .getByLabel(/Loại bài tập/u)
      .selectOption({ label: 'Trắc nghiệm' });
    await page.getByLabel(/Đề bài/u).fill(prompt);
    await page.getByLabel(/Giải thích/u).fill('Giải thích e2e.');
    await page.getByLabel(/Thứ tự/u).fill(String(uniqueOrderIndex()));
    await page.getByRole('button', { name: 'Thêm lựa chọn' }).click();
    await page.getByRole('textbox', { name: 'Lựa chọn 1' }).fill('你好');
    await page.getByRole('textbox', { name: 'Lựa chọn 2' }).fill('再见');
    await page.getByRole('textbox', { name: 'Lựa chọn 3' }).fill('谢谢');
    await page.getByLabel('Đáp án đúng cho lựa chọn 3').check();
    await page.getByRole('button', { name: 'Tạo bài tập' }).click();
    await page.waitForURL(/\/admin\/exercises\/\d+/u);
    const match = /\/admin\/exercises\/(\d+)/u.exec(page.url());
    expect(match).toBeTruthy();
    const exerciseId = Number(match![1]);
    exercisesToArchive.add(exerciseId);

    // Trang sửa điền đúng dữ liệu vừa lưu.
    await expect(
      page.getByRole('heading', { level: 1, name: prompt }),
    ).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Lựa chọn 1' })).toHaveValue(
      '你好',
    );
    await expect(page.getByRole('textbox', { name: 'Lựa chọn 2' })).toHaveValue(
      '再见',
    );
    await expect(page.getByRole('textbox', { name: 'Lựa chọn 3' })).toHaveValue(
      '谢谢',
    );
    await expect(page.getByLabel('Đáp án đúng cho lựa chọn 3')).toBeChecked();
    await expect(page.getByLabel(/Giải thích/u)).toHaveValue('Giải thích e2e.');
    // X11: ô Bài học chỉ đọc dùng tên bài từ context trang, không "Bài học #id".
    await expect(
      page
        .locator('.adm-exercise-form__static')
        .filter({ hasText: 'Greetings & first meetings' }),
    ).toHaveCount(1);
    await expect(page.getByText(/Bài học #/u)).toHaveCount(0);
    // Bài học/chủ đề chỉ đọc khi sửa (TL-18).
    await expect(page.getByText('Bài học', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Lưu bản sửa' }),
    ).toBeEnabled();
  });

  test('(2) sửa: xoá 1 lựa chọn, đổi đáp án → bản sửa 2 giữ id lựa chọn cũ', async ({
    page,
  }, testInfo) => {
    skipUnlessMain(testInfo);
    await loginAsAdmin(page);
    await page.goto(`/admin/exercises/new?lessonId=${seededLessonId}`);
    await page.getByLabel(/Đề bài/u).fill(`E2E sửa ${suffix(testInfo)}`);
    await page.getByLabel(/Thứ tự/u).fill(String(uniqueOrderIndex()));
    await page.getByRole('button', { name: 'Thêm lựa chọn' }).click();
    await page.getByRole('textbox', { name: 'Lựa chọn 1' }).fill('一');
    await page.getByRole('textbox', { name: 'Lựa chọn 2' }).fill('二');
    await page.getByRole('textbox', { name: 'Lựa chọn 3' }).fill('三');
    await page.getByLabel('Đáp án đúng cho lựa chọn 1').check();
    await page.getByRole('button', { name: 'Tạo bài tập' }).click();
    await page.waitForURL(/\/admin\/exercises\/\d+/u);
    const exerciseId = Number(
      /\/admin\/exercises\/(\d+)/u.exec(page.url())![1],
    );
    exercisesToArchive.add(exerciseId);

    // Xoá lựa chọn thứ 2 rồi đổi đáp án sang lựa chọn thứ 3 (giờ là hàng 2).
    const rows = page.locator('.adm-exercise-form__row');
    await rows.nth(1).getByRole('button', { name: 'Xoá' }).click();
    await expect(page.getByRole('textbox', { name: 'Lựa chọn 2' })).toHaveValue(
      '三',
    );
    await page.getByLabel('Đáp án đúng cho lựa chọn 2').check();
    await page.getByRole('button', { name: 'Lưu bản sửa' }).click();
    // X11: vùng role="status" báo đã lưu bản sửa.
    await expect(
      page.getByRole('status').filter({ hasText: 'Đã lưu bản sửa.' }),
    ).toBeVisible();
    await expect(page.getByText(/Bản sửa 2/u).first()).toBeVisible();

    const detail = await loadExerciseDetail(page.request, exerciseId);
    expect(detail.revisions[0]?.revision).toBe(2);
    const snapshot = detail.revisions[0]?.snapshot as {
      content: { options: Array<{ id: string; text: string }> };
      answer: { optionId: string };
    };
    // Id lựa chọn cũ giữ nguyên (P1): opt-1, opt-3; đáp án trỏ opt-3.
    expect(snapshot.content.options.map((option) => option.id)).toEqual([
      'opt-1',
      'opt-3',
    ]);
    expect(snapshot.content.options.map((option) => option.text)).toEqual([
      '一',
      '三',
    ]);
    expect(snapshot.answer.optionId).toBe('opt-3');
  });

  test('(3) điền từ + sắp xếp câu tạo được, payload đúng', async ({
    page,
  }, testInfo) => {
    skipUnlessMain(testInfo);
    await loginAsAdmin(page);

    // Điền từ: 1–100 đáp án chấp nhận + phân biệt hoa/thường; content {}.
    await page.goto(`/admin/exercises/new?lessonId=${seededLessonId}`);
    await page.getByLabel(/Loại bài tập/u).selectOption({ label: 'Điền từ' });
    await page.getByLabel(/Đề bài/u).fill(`E2E điền từ ${suffix(testInfo)}`);
    await page.getByLabel(/Thứ tự/u).fill(String(uniqueOrderIndex()));
    await page.getByLabel('Đáp án chấp nhận 1').fill('好');
    await page.getByLabel('Phân biệt chữ hoa/thường').check();
    await page.getByRole('button', { name: 'Tạo bài tập' }).click();
    await page.waitForURL(/\/admin\/exercises\/\d+/u);
    const fillId = Number(/\/admin\/exercises\/(\d+)/u.exec(page.url())![1]);
    exercisesToArchive.add(fillId);
    const fillDetail = await loadExerciseDetail(page.request, fillId);
    expect(fillDetail.type).toBe('fill_blank');
    expect(fillDetail.content).toEqual({});
    expect(fillDetail.answer).toEqual({
      acceptedTexts: ['好'],
      caseSensitive: true,
    });

    // Sắp xếp câu: thứ tự nhập = thứ tự đúng; "Lên"/"Xuống" đổi chỗ.
    await page.goto(`/admin/exercises/new?lessonId=${seededLessonId}`);
    await page.getByLabel(/Loại bài tập/u).selectOption({
      label: 'Sắp xếp câu',
    });
    await page.getByLabel(/Đề bài/u).fill(`E2E sắp xếp ${suffix(testInfo)}`);
    await page.getByLabel(/Thứ tự/u).fill(String(uniqueOrderIndex()));
    await page.getByRole('button', { name: 'Thêm mảnh' }).click();
    await page.getByLabel('Mảnh câu 1').fill('我');
    await page.getByLabel('Mảnh câu 2').fill('爱');
    await page.getByLabel('Mảnh câu 3').fill('你');
    await page.getByLabel('Đưa mảnh 3 lên').click();
    await page.getByRole('button', { name: 'Tạo bài tập' }).click();
    await page.waitForURL(/\/admin\/exercises\/\d+/u);
    const arrangeId = Number(/\/admin\/exercises\/(\d+)/u.exec(page.url())![1]);
    exercisesToArchive.add(arrangeId);
    const arrange = await loadExerciseDetail(page.request, arrangeId);
    const snapshot = arrange.revisions[0]?.snapshot as {
      content: { tokens: Array<{ id: string; text: string }> };
      answer: { tokenIds: string[] };
    };
    const contentIds = snapshot.content.tokens.map((token) => token.id);
    // X1 (TL-24): người soạn nhập theo thứ tự đúng; hiển thị bị xáo.
    expect(snapshot.answer.tokenIds).toHaveLength(3);
    expect(contentIds).not.toEqual(snapshot.answer.tokenIds);
    expect([...contentIds].sort()).toEqual(
      [...snapshot.answer.tokenIds].sort(),
    );
    const byId = new Map(
      snapshot.content.tokens.map((token) => [token.id, token.text]),
    );
    expect(snapshot.answer.tokenIds.map((id) => byId.get(id))).toEqual([
      '我',
      '你',
      '爱',
    ]);
  });

  test('(4) 422 server trả details.path cho payload client chặn (đáp án chỉ khoảng trắng)', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    // fetch trong browser (same-origin, cookie phiên HttpOnly) — page.request
    // không gửi cookie Secure qua http nên sẽ 401.
    const result = await page.evaluate(
      async (payload) => {
        const response = await fetch('/api/admin/exercises', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return {
          status: response.status,
          body: (await response.json()) as unknown,
        };
      },
      {
        lessonId: seededLessonId,
        type: 'fill_blank',
        prompt: 'E2E 422 details',
        content: {},
        // Client chặn giá trị chỉ có khoảng trắng; gửi thẳng BFF để chứng minh
        // server 422 + details.path đi đúng ô.
        answer: { acceptedTexts: ['   '] },
        explanation: null,
        orderIndex: uniqueOrderIndex(),
      },
    );
    expect(result.status).toBe(422);
    const body = result.body as {
      error: {
        code?: string;
        details?: { path?: string };
      };
    };
    expect(body.error.code).toBe('non_empty_string_required');
    expect(body.error.details?.path).toBe('answer.acceptedTexts[0]');
  });

  test('(5) tự duyệt có cảnh báo Q89 → duyệt → xuất bản → bước 4; lưu trữ ẩn thao tác', async ({
    page,
  }, testInfo) => {
    skipUnlessMain(testInfo);
    await loginAsAdmin(page);
    const exerciseId = await createExerciseViaBackend(page.request, {
      lessonId: seededLessonId,
      type: 'mcq',
      prompt: `E2E duyệt ${suffix(testInfo)}`,
      content: {
        options: [
          { id: 'opt-1', text: '你好' },
          { id: 'opt-2', text: '再见' },
        ],
      },
      answer: { optionId: 'opt-1' },
      explanation: null,
      orderIndex: uniqueOrderIndex(),
    });
    exercisesToArchive.add(exerciseId);

    await page.goto(`/admin/exercises/${exerciseId}`);
    // Q89: admin hiện tại là người viết bản sửa mới nhất → cảnh báo tự duyệt.
    await expect(
      page.getByText(/Bạn là người viết bản sửa này/u),
    ).toBeVisible();
    await page.getByRole('radio', { name: 'Duyệt' }).check();
    await page.getByRole('button', { name: 'Gửi đánh giá' }).click();
    const publishButton = page.getByRole('button', { name: 'Xuất bản' });
    await expect(publishButton).toBeEnabled();
    await publishButton.click();
    await expect(
      page.locator('.adm-flow-current__state', { hasText: 'Đã xuất bản' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Xuất bản' })).toBeDisabled();
    await expect(
      page.getByText('Bản sửa mới nhất đã được xuất bản.'),
    ).toBeVisible();

    // Lưu trữ inline → mọi thao tác biến mất.
    await page.getByRole('button', { name: 'Lưu trữ' }).click();
    await page.getByRole('button', { name: 'Xác nhận lưu trữ' }).click();
    await expect(
      page.getByText(/Đã lưu trữ — không thể thay đổi/u),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Xuất bản' })).toHaveCount(0);
    exercisesToArchive.delete(exerciseId);
  });

  test('(6) luyện nói → tự duyệt Q89 → khối quy trình tắt Xuất bản kèm lý do', async ({
    page,
  }, testInfo) => {
    skipUnlessMain(testInfo);
    await loginAsAdmin(page);
    await page.goto(`/admin/exercises/new?lessonId=${seededLessonId}`);
    await page.getByLabel(/Loại bài tập/u).selectOption({ label: 'Luyện nói' });
    await page.getByLabel(/Đề bài/u).fill(`E2E luyện nói ${suffix(testInfo)}`);
    await page.getByLabel(/Thứ tự/u).fill(String(uniqueOrderIndex()));
    await page.getByLabel(/Câu mẫu/u).fill('你好');
    await page.getByRole('button', { name: 'Tạo bài tập' }).click();
    await page.waitForURL(/\/admin\/exercises\/\d+/u);
    const exerciseId = Number(
      /\/admin\/exercises\/(\d+)/u.exec(page.url())![1],
    );
    exercisesToArchive.add(exerciseId);

    // X7: mọi assert nằm TRONG khối "Quy trình xuất bản", không .first() toàn trang.
    const workflow = page.locator('.adm-panel').filter({
      has: page.getByRole('heading', { name: 'Quy trình xuất bản' }),
    });
    await expect(
      workflow.getByRole('button', { name: 'Xuất bản' }),
    ).toBeDisabled();
    await expect(
      workflow.getByText('Loại này chưa xuất bản được.'),
    ).toBeVisible();

    // Q89: tự duyệt (admin hiện tại là người viết) vẫn bị khoá Xuất bản.
    await workflow.getByRole('radio', { name: 'Duyệt' }).check();
    await workflow.getByRole('button', { name: 'Gửi đánh giá' }).click();
    await expect(
      workflow.getByText(/Bạn là người viết bản sửa này/u),
    ).toBeVisible();
    await expect(
      workflow.getByRole('button', { name: 'Xuất bản' }),
    ).toBeDisabled();
    await expect(
      workflow.getByText('Loại này chưa xuất bản được.'),
    ).toBeVisible();
  });

  test('(7) nghe chọn: audio fixture → duyệt → xuất bản được', async ({
    page,
  }, testInfo) => {
    skipUnlessMain(testInfo);
    await loginAsAdmin(page);
    await page.goto(`/admin/exercises/new?lessonId=${seededLessonId}`);
    await page.getByLabel(/Loại bài tập/u).selectOption({ label: 'Nghe chọn' });
    await page.getByLabel(/Đề bài/u).fill(`E2E nghe ${suffix(testInfo)}`);
    await page.getByLabel(/Thứ tự/u).fill(String(uniqueOrderIndex()));
    await page.getByLabel(/Audio/u).selectOption(String(readyAudioId));
    await page.getByRole('textbox', { name: 'Lựa chọn 1' }).fill('mā');
    await page.getByRole('textbox', { name: 'Lựa chọn 2' }).fill('má');
    await page.getByLabel('Đáp án đúng cho lựa chọn 1').check();
    await page.getByRole('button', { name: 'Tạo bài tập' }).click();
    await page.waitForURL(/\/admin\/exercises\/\d+/u);
    const exerciseId = Number(
      /\/admin\/exercises\/(\d+)/u.exec(page.url())![1],
    );
    exercisesToArchive.add(exerciseId);

    await page.getByRole('radio', { name: 'Duyệt' }).check();
    await page.getByRole('button', { name: 'Gửi đánh giá' }).click();
    const publishButton = page.getByRole('button', { name: 'Xuất bản' });
    await expect(publishButton).toBeEnabled();
    await publishButton.click();
    await expect(
      page.locator('.adm-flow-current__state', { hasText: 'Đã xuất bản' }),
    ).toBeVisible();
  });

  test('(8) POST chéo origin tới mọi route BFF bài tập → 403', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    for (const path of [
      '/api/admin/exercises',
      '/api/admin/exercises/1/revisions',
      '/api/admin/exercises/1/revisions/1/reviews',
      '/api/admin/exercises/1/revisions/1/publish',
      '/api/admin/exercises/1/archive',
    ]) {
      const response = await page.request.post(path, {
        headers: { origin: 'https://attacker.example' },
        data: {},
      });
      expect(response.status(), path).toBe(403);
      expect(response.headers()['cache-control']).toBe('no-store');
    }
  });

  test('(9) id route sai → not-found, BFF trả 400 trước backend', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    for (const url of [
      '/admin/exercises/abc',
      '/admin/exercises/0',
      '/admin/exercises/01',
      '/admin/exercises/2147483648',
    ]) {
      await page.goto(url);
      await expect(
        page.getByRole('heading', { name: 'Không tìm thấy bài tập' }),
      ).toBeVisible();
    }
    for (const path of [
      '/api/admin/exercises/abc/revisions',
      '/api/admin/exercises/abc/archive',
      '/api/admin/exercises/1/revisions/abc/publish',
      '/api/admin/exercises/1/revisions/abc/reviews',
    ]) {
      const response = await page.request.post(path, {
        headers: { origin: 'http://127.0.0.1:3200' },
        data: {},
      });
      expect(response.status(), path).toBe(400);
    }
  });

  test('(10) axe 0 vi phạm + đề 300 ký tự liền @390 không cuộn ngang', async ({
    page,
  }, testInfo) => {
    await loginAsAdmin(page);
    const exerciseId = await createExerciseViaBackend(page.request, {
      lessonId: seededLessonId,
      type: 'mcq',
      prompt: `E2E axe ${suffix(testInfo)}`,
      content: {
        options: [
          { id: 'opt-1', text: '你好' },
          { id: 'opt-2', text: '再见' },
        ],
      },
      answer: { optionId: 'opt-1' },
      explanation: null,
      orderIndex: uniqueOrderIndex(),
    });
    exercisesToArchive.add(exerciseId);
    for (const url of [
      `/admin/exercises/new?lessonId=${seededLessonId}`,
      `/admin/exercises/${exerciseId}`,
    ]) {
      await page.goto(url);
      await page.locator('main').first().waitFor();
      const accessibility = await new AxeBuilder({ page })
        .include('main')
        .analyze();
      expect(
        accessibility.violations,
        `${url}: ${JSON.stringify(accessibility.violations)}`,
      ).toEqual([]);
    }

    // X10: đề bài 300 ký tự pinyin liền (không dấu cách) ở 390px không tràn
    // ngang; tiêu đề trang sửa overflow-wrap:anywhere.
    const longPrompt = 'a'.repeat(300);
    const longId = await createExerciseViaBackend(page.request, {
      lessonId: seededLessonId,
      type: 'mcq',
      prompt: longPrompt,
      content: {
        options: [
          { id: 'opt-1', text: '你好' },
          { id: 'opt-2', text: '再见' },
        ],
      },
      answer: { optionId: 'opt-1' },
      explanation: null,
      orderIndex: uniqueOrderIndex(),
    });
    exercisesToArchive.add(longId);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/exercises/${longId}`);
    await expect(
      page.getByRole('heading', { level: 1, name: longPrompt }),
    ).toBeVisible();
    const overflow = await page.evaluate(() => ({
      html: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      inner: window.innerWidth,
    }));
    expect(overflow.html).toBeLessThanOrEqual(overflow.inner);
    expect(overflow.body).toBeLessThanOrEqual(overflow.inner);
    const axe390 = await new AxeBuilder({ page }).include('main').analyze();
    expect(
      axe390.violations,
      `390 long prompt: ${JSON.stringify(axe390.violations)}`,
    ).toEqual([]);

    // X9: vùng bấm ô "Phân biệt chữ hoa/thường" ≥ 2.75rem (44px) ở ≤900px.
    await page.goto(`/admin/exercises/new?lessonId=${seededLessonId}`);
    await page.getByLabel(/Loại bài tập/u).selectOption({ label: 'Điền từ' });
    const checkMinSize = await page
      .locator('.adm-exercise-form__check')
      .evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).minBlockSize || '0'),
      );
    expect(checkMinSize).toBeGreaterThanOrEqual(44);
  });

  test('(11) ?lessonId= bài đã lưu trữ → báo không thêm được và không có form; ô chọn bỏ bài đó', async ({
    page,
  }, testInfo) => {
    await loginAsAdmin(page);
    const token = await adminToken(page.request);
    const title = `E2E bài lưu trữ ${suffix(testInfo)}`;
    const slugBase = `e2e-archived-${suffix(testInfo)}-${Date.now().toString(36)}`;
    const lessonId = await createLessonForArchive(
      page.request,
      title,
      slugBase,
    );
    const archived = await page.request.post(
      `${BACKEND}/admin/cms/lessons/${lessonId}/archive`,
      { headers: { authorization: `Bearer ${token}` }, data: {} },
    );
    expect(archived.ok(), await archived.text()).toBeTruthy();

    // X6a: URL trực tiếp tới bài đã lưu trữ → câu báo, không có form.
    await page.goto(`/admin/exercises/new?lessonId=${lessonId}`);
    await expect(
      page.getByText('Bài học đã lưu trữ, không thêm bài tập được.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tạo bài tập' })).toHaveCount(
      0,
    );

    // Y7: chỉ kiểm ô chọn khi trang 1 thô từ backend CÓ bài lưu trữ vừa tạo.
    const rawPage = await backendGet<{
      data: Array<{ id: number; status: string }>;
    }>(page.request, '/admin/cms/lessons?page=1&limit=100');
    const rawHasArchived = rawPage.data.some(
      (lesson) => lesson.id === lessonId && lesson.status === 'archived',
    );
    if (!rawHasArchived) {
      // Trang 1 thô không chứa bài vừa tạo (DB đã vượt 100 bài) → bỏ phần
      // kiểm ô chọn; phần chặn qua ?lessonId= ở trên vẫn giữ nguyên.
      testInfo.annotations.push({
        type: 'bỏ-kiểm-ô-chọn',
        description: `trang 1 thô không chứa lesson ${lessonId}; chỉ giữ kiểm ?lessonId=`,
      });
      return;
    }
    // X6b: ô chọn bài học không chứa bài đã lưu trữ.
    await page.goto('/admin/exercises/new');
    const options = await page
      .locator('#exercise-lesson option')
      .allTextContents();
    expect(options.some((text) => text.includes(title))).toBe(false);
  });
});
