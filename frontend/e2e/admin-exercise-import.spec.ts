import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from '@playwright/test';

import {
  BACKEND,
  backendLogin,
  readCspViolations,
  watchCsp,
} from './support/learner-fixtures';
import { queryDisposableDb, sqlLiteral } from './support/disposable-db';

/**
 * M5.1b2 — trang Nhập dữ liệu bài tập JSON (TL-29, TL-33).
 *
 * Luồng ghi (2)(3)(4) chỉ chạy ở hai viewport chính; (1)(5)(6)(7) chạy cả 4
 * project. JSON viết ngay trong test (không đọc docs/ui_reference); sourceKey
 * có hậu tố duy nhất mỗi lần chạy; dọn bằng archive bài đã nhập.
 */

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? 'admin.frontend@example.test';
const adminPassword =
  process.env.E2E_ADMIN_PASSWORD ?? 'FrontendTest-Admin-123';
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3200';
const origin = new URL(baseURL).origin;
const DATA_SOURCE_CODE = 'FRONTEND_CONSOLE_V1';
const MAIN_PROJECTS = new Set(['desktop-1440', 'mobile-390']);
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
const importedExerciseIds = new Set<number>();

function skipUnlessMain(testInfo: TestInfo) {
  test.skip(
    !MAIN_PROJECTS.has(testInfo.project.name),
    'luồng ghi chỉ chạy ở desktop-1440 + mobile-390',
  );
}

async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Mật khẩu').fill(adminPassword);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.waitForURL(/\/(admin\/|forbidden)/u);
}

async function adminToken(request: APIRequestContext): Promise<string> {
  return backendLogin(request, adminEmail, adminPassword);
}

/** Z9: archive bài đã nhập và khẳng định 2xx hoặc 409 CONTENT_ARCHIVED. */
async function archiveImported(
  request: APIRequestContext,
  exerciseId: number,
): Promise<void> {
  const token = await adminToken(request);
  const response = await request.post(
    `${BACKEND}/admin/cms/exercises/${exerciseId}/archive`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const status = response.status();
  if (status >= 200 && status < 300) return;
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string };
  } | null;
  if (status === 409 && body?.error?.code === 'CONTENT_ARCHIVED') return;
  throw new Error(
    `archive bài ${exerciseId} thất bại: status=${status} body=${JSON.stringify(body)}`,
  );
}

function publishedLessonId(): number {
  const raw = queryDisposableDb(
    'SELECT id FROM "Lesson" WHERE status = \'published\' AND "deletedAt" IS NULL ORDER BY id ASC LIMIT 1',
  );
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`Không có bài học published để nhập bài tập: "${raw}"`);
  }
  return id;
}

function exerciseRow(index: number, lessonId: number) {
  return {
    sourceKey: `e2e-import-${suffix}-${index}`,
    lessonId,
    topicId: null,
    type: 'mcq',
    prompt: `Bài nhập E2E ${suffix} #${index}`,
    content: {
      options: [
        { id: 'opt-1', text: '你好' },
        { id: 'opt-2', text: '再见' },
      ],
    },
    answer: { optionId: 'opt-1' },
    explanation: null,
    orderIndex: 1000 + index,
  };
}

async function selectDataSource(page: Page) {
  const value = await page
    .locator('#import-source option')
    .evaluateAll((options) => {
      const match = options.find((option) =>
        (option.textContent ?? '').includes('FRONTEND_CONSOLE_V1'),
      );
      return match?.getAttribute('value') ?? '';
    });
  expect(value, `thiếu nguồn dữ liệu ${DATA_SOURCE_CODE}`).not.toBe('');
  await page.selectOption('#import-source', value);
}

async function uploadJson(
  page: Page,
  name: string,
  rows: unknown[],
): Promise<void> {
  await page.setInputFiles('#import-file', {
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(rows), 'utf8'),
  });
}

function previewButton(page: Page) {
  return page.getByRole('button', { name: /Xem trước & kiểm tra/u });
}

function commitButton(page: Page) {
  return page.getByRole('button', { name: /^Nhập dữ liệu$/u });
}

test.afterEach(async ({ request }) => {
  for (const exerciseId of [...importedExerciseIds]) {
    await archiveImported(request, exerciseId);
    importedExerciseIds.delete(exerciseId);
  }
});

test.describe('M5.1b2 — nhập bài tập JSON', () => {
  test('(1) sidebar "Nhập dữ liệu" là link mở /admin/import với aria-current', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/exercises');

    // ≤900px sidebar là drawer đóng sẵn: mở bằng nút menu trước khi bấm mục.
    const menu = page.getByRole('button', { name: 'Mở hoặc thu gọn menu' });
    if (await menu.isVisible()) await menu.click();
    const navLink = page.getByRole('link', { name: 'Nhập dữ liệu' });
    await expect(navLink).toHaveAttribute('href', '/admin/import');
    await navLink.click();
    await page.waitForURL(/\/admin\/import$/u);
    await expect(
      page.getByRole('heading', { name: 'Nhập dữ liệu', level: 1 }),
    ).toBeVisible();
    await expect(
      page.locator('.adm-import-steps [aria-current="step"]'),
    ).toContainText('Tải dữ liệu');

    if (await menu.isVisible()) await menu.click();
    await expect(
      page.getByRole('link', { name: 'Nhập dữ liệu' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('(2) preview lỗi: trùng sourceKey trong lô + lessonId không tồn tại', async ({
    page,
  }, testInfo) => {
    skipUnlessMain(testInfo);
    await loginAsAdmin(page);
    await page.goto('/admin/import');
    await selectDataSource(page);

    const duplicateKey = `e2e-import-${suffix}-dup`;
    const missingLesson = 2_147_483_000;
    await uploadJson(page, `preview-${suffix}.json`, [
      { ...exerciseRow(1, missingLesson), sourceKey: duplicateKey },
      { ...exerciseRow(2, missingLesson), sourceKey: duplicateKey },
      exerciseRow(3, missingLesson),
    ]);

    await previewButton(page).click();
    await expect(page.getByText('Kết quả kiểm tra')).toBeVisible();
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    // 2 lỗi DUPLICATE_SOURCE_KEY_IN_BATCH + 1 lỗi PARENT_LESSON_NOT_FOUND.
    await expect(
      table.getByRole('row', { name: /Mã nguồn bị trùng trong tệp\./u }),
    ).toHaveCount(2);
    await expect(
      table.getByRole('row', {
        name: /Bài học không tồn tại hoặc chưa xuất bản\./u,
      }),
    ).toHaveCount(1);
    await expect(commitButton(page)).toBeDisabled();
    await expect(
      page.locator('.adm-import-steps [aria-current="step"]'),
    ).toContainText('Xem trước & kiểm tra');
  });

  test('(3) thành công: nhập 2 bài, status + link sửa, DB draft đúng nguồn', async ({
    page,
  }, testInfo) => {
    skipUnlessMain(testInfo);
    const lessonId = publishedLessonId();
    const rows = [exerciseRow(1, lessonId), exerciseRow(2, lessonId)];
    await loginAsAdmin(page);
    await page.goto('/admin/import');
    await selectDataSource(page);
    await uploadJson(page, `success-${suffix}.json`, rows);
    await expect(page.getByText(/2 dòng/u)).toBeVisible();

    await previewButton(page).click();
    await expect(page.getByText('Kết quả kiểm tra')).toBeVisible();
    await expect(commitButton(page)).toBeEnabled();
    // Z9: lấy id bài vừa nhập NGAY từ phản hồi commit, trước mọi assert UI.
    const commitResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/admin/exercise-imports') &&
        response.request().method() === 'POST' &&
        response.status() === 200,
    );
    await commitButton(page).click();
    const commitResponse = await commitResponsePromise;
    const commitPayload = (await commitResponse.json()) as {
      data?: { exercises?: { id: number }[] };
    };
    const committedIds = (commitPayload.data?.exercises ?? []).map(
      (exercise) => exercise.id,
    );
    if (committedIds.length !== 2) {
      throw new Error(
        `phản hồi commit phải có 2 bài, nhận: ${JSON.stringify(commitPayload)}`,
      );
    }
    for (const id of committedIds) importedExerciseIds.add(id);

    const status = page.getByRole('status');
    await expect(status).toHaveText('Đã nhập 2 bài tập ở trạng thái Bản nháp.');
    const links = page.getByRole('link', { name: /^Bài tập #\d+$/u });
    await expect(links).toHaveCount(2);
    const hrefs = await links.evaluateAll((items) =>
      items.map((item) => item.getAttribute('href') ?? ''),
    );
    expect(hrefs).toHaveLength(2);
    for (const href of hrefs) {
      const match = /^\/admin\/exercises\/(\d+)$/u.exec(href);
      expect(match, `href bài tập không đúng: ${href}`).not.toBeNull();
      if (match) {
        expect(committedIds).toContain(Number(match[1]));
        importedExerciseIds.add(Number(match[1]));
      }
    }
    // W6: sau thành công hai nút phải bật; "Nhập tệp khác" về bước 1, xoá kết quả.
    const newFileButton = page.getByRole('button', { name: 'Nhập tệp khác' });
    const chooseAnotherButton = page.getByRole('button', {
      name: 'Chọn tệp khác',
    });
    await expect(newFileButton).toBeEnabled();
    await expect(chooseAnotherButton).toBeEnabled();
    await newFileButton.click();
    await expect(
      page.locator('.adm-import-steps [aria-current="step"]'),
    ).toContainText('Tải dữ liệu');
    await expect(
      page.getByRole('heading', { name: 'Đã nhập dữ liệu' }),
    ).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveCount(0);

    const dataSourceRaw = queryDisposableDb(
      `SELECT id FROM "DataSource" WHERE code = ${sqlLiteral(DATA_SOURCE_CODE)}`,
    );
    const dataSourceId = Number(dataSourceRaw);
    for (const row of rows) {
      const raw = queryDisposableDb(
        `SELECT status || '|' || "dataSourceId" FROM "LessonExercise" WHERE "sourceKey" = ${sqlLiteral(row.sourceKey)}`,
      );
      expect(raw).toBe(`draft|${dataSourceId}`);
    }

    // Link trong kết quả mở được trang sửa của bài vừa nhập.
    await page.goto(hrefs[0] ?? '/admin/import');
    await page.waitForURL(/\/admin\/exercises\/\d+/u);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('(4) tệp 101 dòng và tệp > 90 KB bị chặn ở client, không gọi preview', async ({
    page,
  }, testInfo) => {
    skipUnlessMain(testInfo);
    await loginAsAdmin(page);
    await page.goto('/admin/import');
    await selectDataSource(page);

    let previewRequests = 0;
    page.on('request', (next) => {
      if (next.url().includes('/api/admin/exercise-imports/preview')) {
        previewRequests += 1;
      }
    });

    const lessonId = publishedLessonId();
    const tooManyRows = Array.from({ length: 101 }, (_, index) =>
      exerciseRow(index + 1, lessonId),
    );
    await uploadJson(page, `too-many-${suffix}.json`, tooManyRows);
    await expect(page.locator('#import-file-error')).toContainText(
      'quá 100 dòng',
    );
    await expect(previewButton(page)).toBeDisabled();

    const oversizeRows = [
      { ...exerciseRow(1, lessonId), explanation: 'x'.repeat(96_000) },
    ];
    await uploadJson(page, `oversize-${suffix}.json`, oversizeRows);
    await expect(page.locator('#import-file-error')).toContainText(
      'Tệp tối đa 90 KB.',
    );
    await expect(previewButton(page)).toBeDisabled();
    expect(previewRequests).toBe(0);
  });

  test('(5) POST cross-origin tới 2 route BFF → 403; commit thiếu key → 400', async ({
    page,
    request,
  }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/import');

    // Z10: body đúng shape với id thật để lỗi nhận được chỉ là lỗi thiếu key.
    const dataSourceId = Number(
      queryDisposableDb(
        `SELECT id FROM "DataSource" WHERE code = ${sqlLiteral(DATA_SOURCE_CODE)}`,
      ),
    );
    const lessonId = publishedLessonId();
    const body = {
      dataSourceId,
      fileName: `cross-${suffix}.json`,
      rows: [exerciseRow(1, lessonId)],
    };
    for (const path of [
      '/api/admin/exercise-imports/preview',
      '/api/admin/exercise-imports',
    ]) {
      const cross = await page.request.post(`${origin}${path}`, {
        headers: { origin: 'https://attacker.example' },
        data: body,
      });
      expect(cross.status(), `cross-origin ${path}`).toBe(403);
    }

    // Gửi cookie phiên admin TƯỜNG MINH (token backend) để không phụ thuộc
    // hành vi chia sẻ cookie jar của APIRequestContext; nhờ vậy test đúng thứ
    // tự handler: Origin → cookie → body → key. Thiếu key phải là 400 (không
    // phải 401) kèm mã máy INVALID_IDEMPOTENCY_KEY.
    const session = await adminToken(request);
    const missingKey = await page.request.post(
      `${origin}/api/admin/exercise-imports`,
      {
        headers: {
          origin,
          cookie: `hsk_admin_session=${session}`,
        },
        data: body,
      },
    );
    expect(missingKey.status()).toBe(400);
    const missingKeyBody = (await missingKey.json()) as {
      error?: { code?: string };
    };
    expect(missingKeyBody.error?.code).toBe('INVALID_IDEMPOTENCY_KEY');
  });

  test('(6) axe 0 vi phạm; 390px không cuộn ngang', async ({
    page,
  }, testInfo) => {
    await loginAsAdmin(page);
    await page.goto('/admin/import');
    await expect(
      page.getByRole('heading', { name: 'Nhập dữ liệu', level: 1 }),
    ).toBeVisible();

    const results = await new AxeBuilder({ page }).include('main').analyze();
    expect(results.violations).toEqual([]);

    const metrics = await page.evaluate(() => ({
      html: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    if (testInfo.project.name === 'mobile-390') {
      expect(metrics.html, JSON.stringify(metrics)).toBeLessThanOrEqual(
        metrics.innerWidth,
      );
      expect(metrics.body, JSON.stringify(metrics)).toBeLessThanOrEqual(
        metrics.innerWidth,
      );
    }
  });

  test('(7) không vi phạm CSP', async ({ page }) => {
    const consoleViolations = await watchCsp(page);
    await loginAsAdmin(page);
    await page.goto('/admin/import');
    await expect(
      page.getByRole('heading', { name: 'Nhập dữ liệu', level: 1 }),
    ).toBeVisible();
    const violations = await readCspViolations(page);
    expect(violations).toEqual([]);
    expect(
      consoleViolations.filter((item) =>
        item.includes('Content Security Policy'),
      ),
    ).toEqual([]);
  });
});
