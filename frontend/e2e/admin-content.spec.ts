import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { queryDisposableDb } from './support/disposable-db';
import { BACKEND, backendLogin } from './support/learner-fixtures';

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? 'admin.frontend@example.test';
const adminPassword =
  process.env.E2E_ADMIN_PASSWORD ?? 'FrontendTest-Admin-123';

/**
 * S4 (R6): id lesson flow 4 đã publish, dọn bằng afterEach qua backend trực
 * tiếp — không phụ thuộc page còn mở và không nuốt lỗi dọn.
 */
const lessonsToArchive = new Set<number>();

async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Mật khẩu').fill(adminPassword);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.waitForURL(/\/(admin\/exercises|forbidden)/);
}

/** Flows 2–5 chỉ chạy ở 2 viewport chính; dữ liệu tạo mới có suffix project. */
const MAIN_PROJECTS = new Set(['desktop-1440', 'mobile-390']);

function skipUnlessMain(testInfo: TestInfo) {
  test.skip(
    !MAIN_PROJECTS.has(testInfo.project.name),
    'flow chính chỉ chạy ở desktop-1440 + mobile-390',
  );
}

/** Hậu tố an toàn cho slug/title theo project (không phân biệt hoa thường). */
function suffix(testInfo: TestInfo): string {
  return testInfo.project.name.replace(/[^a-z0-9]/gu, '-');
}

/** Slug unique theo project + timestamp để chạy lại không đụng unique key. */
function uniqueSlug(testInfo: TestInfo, base: string): string {
  return `${base}-${suffix(testInfo)}-${Date.now().toString(36)}`;
}

async function createLesson(page: Page, testInfo: TestInfo, title: string) {
  await page.goto('/admin/content/lessons/new');
  await page.getByLabel(/Tiêu đề/u).fill(title);
  await page.getByLabel(/Cấp độ/u).selectOption({ label: 'HSK 1' });
  await page.getByLabel(/Mô tả/u).fill('Bài học do e2e tạo.');
  // Lesson có unique (levelId, orderIndex): orderIndex unique theo thời gian.
  await page
    .getByLabel(/Thứ tự/u)
    .fill(String(900_000 + (Date.now() % 99_999)));
  await page.getByLabel(/Slug/u).fill(uniqueSlug(testInfo, 'e2e-lesson'));
  await page.getByRole('button', { name: 'Tạo bài học' }).click();
  await page.waitForURL(/\/admin\/content\/lessons\/\d+/u);
  const match = /\/admin\/content\/lessons\/(\d+)/u.exec(page.url());
  expect(match).toBeTruthy();
  return Number(match?.[1]);
}

async function createTopicViaUi(
  page: Page,
  lessonId: number,
  title: string,
  orderIndex = 1,
) {
  await page.goto(`/admin/content/topics/new?lessonId=${lessonId}`);
  await page.getByLabel(/Tiêu đề/u).fill(title);
  await page
    .getByLabel(/Nội dung JSON/u)
    .fill('[{"type":"text","value":"一二三"}]');
  await page.getByLabel(/Thứ tự/u).fill(String(orderIndex));
  await page.getByRole('button', { name: 'Tạo chủ đề' }).click();
  await page.waitForURL(/\/admin\/content\/topics\/\d+/u);
  const match = /\/admin\/content\/topics\/(\d+)/u.exec(page.url());
  expect(match).toBeTruthy();
  return Number(match?.[1]);
}

/** Text trong vùng bảng/card swap: chỉ nhận phần tử đang hiển thị. */
function visibleText(page: Page, text: string) {
  return page.getByText(text).filter({ visible: true });
}

/** Duyệt + xuất bản bản sửa mới nhất từ trang chi tiết hiện tại. */
async function approveAndPublish(page: Page) {
  await page.getByRole('radio', { name: 'Duyệt' }).check();
  await page.getByRole('button', { name: 'Gửi đánh giá' }).click();
  const publishButton = page.getByRole('button', { name: 'Xuất bản' });
  await expect(publishButton).toBeEnabled();
  await publishButton.click();
  await expect(
    page.locator('.adm-badge--ok', { hasText: 'Đã xuất bản' }).first(),
  ).toBeVisible();
}

test.describe('M5.1a — trang Nội dung (CMS lesson/topic)', () => {
  // S4 (R6): dọn cả khi assertion fail. Login thẳng backend bằng tài khoản
  // admin seed qua fixture `request` (APIRequestContext riêng): cookie phiên
  // browser là Secure nên không dùng page.request được, và page có thể đã
  // đóng khi test fail.
  test.afterEach(async ({ request }) => {
    const ids = [...lessonsToArchive];
    lessonsToArchive.clear();
    if (ids.length === 0) return;
    const token = await backendLogin(request, adminEmail, adminPassword);
    for (const id of ids) {
      const response = await request.post(
        `${BACKEND}/admin/cms/lessons/${id}/archive`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (response.ok()) continue;
      // Backend archive là idempotent (2xx + idempotent true). 409 chỉ được
      // chấp nhận khi nội dung đã ở trạng thái lưu trữ.
      expect(response.status(), `archive lesson ${id}`).toBe(409);
      const payload = (await response.json()) as {
        error?: { code?: string };
      };
      expect(payload.error?.code, `archive lesson ${id}`).toBe(
        'CONTENT_ARCHIVED',
      );
    }
  });

  test('flow 1: danh sách, lọc, phân trang, card ≤900px, axe', async ({
    page,
  }, testInfo) => {
    await loginAsAdmin(page);
    await page.goto('/admin/content');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Nội dung' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Tạo bài học' })).toBeVisible();

    // Lọc theo trạng thái Bản nháp: thấy bài draft của seed, không thấy bài published.
    await page
      .getByRole('search', { name: 'Lọc bài học' })
      .getByLabel('Trạng thái')
      .selectOption('draft');
    await page.getByRole('button', { name: 'Lọc', exact: true }).click();
    await expect(page).toHaveURL(/status=draft/u);
    await expect(visibleText(page, 'Numbers & counting').first()).toBeVisible();
    await expect(page.getByText('Making plans')).toHaveCount(0);

    // Tìm kiếm theo tiêu đề.
    await page.getByLabel(/Tìm kiếm theo tiêu đề/u).fill('numbers');
    await page.getByRole('button', { name: 'Lọc', exact: true }).click();
    await expect(page).toHaveURL(/search=numbers/u);
    await expect(visibleText(page, 'Numbers & counting').first()).toBeVisible();

    // Xoá lọc về mặc định.
    await page.getByRole('link', { name: 'Xoá lọc' }).first().click();
    await expect(page).not.toHaveURL(/status=/u);
    await expect(
      visibleText(page, 'Greetings & first meetings').first(),
    ).toBeVisible();

    // Phân trang server: limit=1&page=2 → "Hiển thị 2 đến 2 của N".
    await page.goto('/admin/content?limit=1&page=2');
    await expect(
      page.getByText(/Hiển thị 2 đến 2 của \d+ kết quả/u),
    ).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Phân trang bài học' })
      .getByRole('link', { name: /Trước/u })
      .click();
    await expect(page).toHaveURL(/page=1/u);

    // Swap bảng/card theo viewport: breakpoint ≤900px (mobile-390, tablet-768).
    const narrow = (testInfo.project.use.viewport?.width ?? 1440) <= 900;
    const tableWrap = page.locator('.adm-table-wrap--swap');
    const recordList = page.locator('.adm-record-list--swap');
    if (narrow) {
      await expect(tableWrap).toBeHidden();
      await expect(recordList).toBeVisible();
    } else {
      await expect(tableWrap).toBeVisible();
      await expect(recordList).toBeHidden();
    }

    await page.goto('/admin/content');
    const accessibility = await new AxeBuilder({ page })
      .include('main')
      .analyze();
    expect(accessibility.violations).toEqual([]);
  });

  test('flow 2: tạo bài học → thêm chủ đề → JSON lỗi dòng/cột → sửa → lưu được', async ({
    page,
  }, testInfo) => {
    skipUnlessMain(testInfo);
    await loginAsAdmin(page);
    const lessonTitle = `E2E tạo bài ${suffix(testInfo)}`;
    const lessonId = await createLesson(page, testInfo, lessonTitle);

    // Trang chi tiết sau tạo: breadcrumb, nút Thêm chủ đề.
    await expect(
      page.getByRole('heading', { level: 1, name: lessonTitle }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Thêm chủ đề' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/content/topics/new\\?lessonId=${lessonId}`, 'u'),
    );

    // JSON sai cú pháp (unquoted key — V8 báo kèm vị trí) → lỗi dòng/cột +
    // aria-invalid trên textarea. Lưu ý: trailing comma trong V8 trả message
    // không có vị trí nên không dùng dạng đó để test dòng/cột.
    await page.getByLabel(/Tiêu đề/u).fill(`Chủ đề ${suffix(testInfo)}`);
    await page
      .getByLabel(/Nội dung JSON/u)
      .fill('[\n  { "type": "text" },\n  { bad\n]');
    await page.getByLabel(/Thứ tự/u).fill('1');
    await page.getByRole('button', { name: 'Tạo chủ đề' }).click();
    const alert = page.locator('p[role="alert"]');
    await expect(alert).toContainText(/JSON sai ở dòng \d+, cột \d+/u);
    await expect(page.getByLabel(/Nội dung JSON/u)).toHaveAttribute(
      'aria-invalid',
      'true',
    );

    // Sửa JSON hợp lệ → tạo được, về trang chi tiết chủ đề.
    await page
      .getByLabel(/Nội dung JSON/u)
      .fill('[{"type":"text","value":"你好"}]');
    await page.getByRole('button', { name: 'Tạo chủ đề' }).click();
    await page.waitForURL(/\/admin\/content\/topics\/\d+/u);

    // Link ← Bài học quay lại đúng trang lesson, bảng chủ đề có bản ghi mới.
    await page.getByRole('link', { name: '← Bài học' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/content/lessons/${lessonId}`, 'u'),
    );
    await expect(
      page.getByRole('link', { name: `Chủ đề ${suffix(testInfo)}` }),
    ).toBeVisible();

    // R7: bảng "Chủ đề của bài" đổi sang thẻ ở ≤900px như danh sách nội dung.
    const narrow = (testInfo.project.use.viewport?.width ?? 1440) <= 900;
    const topicsTable = page.locator('.adm-table-wrap--swap');
    const topicsCards = page.locator('.adm-record-list--swap');
    if (narrow) {
      await expect(topicsTable).toBeHidden();
      await expect(topicsCards).toBeVisible();
    } else {
      await expect(topicsTable).toBeVisible();
      await expect(topicsCards).toBeHidden();
    }
  });

  test('flow 3: cảnh báo tự duyệt (Q89) → duyệt → xuất bản chủ đề', async ({
    page,
  }, testInfo) => {
    skipUnlessMain(testInfo);
    await loginAsAdmin(page);
    const lessonId = await createLesson(
      page,
      testInfo,
      `E2E duyệt ${suffix(testInfo)}`,
    );
    const topicId = await createTopicViaUi(
      page,
      lessonId,
      `Chủ đề duyệt ${suffix(testInfo)}`,
    );

    await page.goto(`/admin/content/topics/${topicId}`);
    // Q89: bản sửa do chính admin đang đăng nhập viết → cảnh báo tĩnh.
    await expect(
      page.getByText(
        'Bạn là người viết bản sửa này. Tự duyệt được phép và sẽ được ghi lại.',
      ),
    ).toBeVisible();
    // Publish bị khoá khi chưa duyệt, kèm lý do.
    const publishButton = page.getByRole('button', { name: 'Xuất bản' });
    await expect(publishButton).toBeDisabled();
    await expect(
      page.getByText('Bản sửa mới nhất đang chờ duyệt.'),
    ).toBeVisible();

    // TL-17: chưa chọn quyết định → chặn gửi, báo lỗi ngay cạnh nhóm radio,
    // focus vào radio đầu (không chọn sẵn quyết định nào).
    for (const radio of await page.getByRole('radio').all()) {
      await expect(radio).not.toBeChecked();
    }
    await page.getByRole('button', { name: 'Gửi đánh giá' }).click();
    await expect(page.locator('p[role="alert"]')).toContainText(
      'Vui lòng chọn quyết định đánh giá.',
    );
    const firstDecision = page.getByRole('radio', { name: 'Duyệt' });
    await expect(firstDecision).toBeFocused();
    await expect(firstDecision).toHaveAttribute(
      'aria-describedby',
      'review-decision-error',
    );

    await firstDecision.check();
    await page.getByRole('button', { name: 'Gửi đánh giá' }).click();
    // TL-13: người duyệt gần nhất là "Bạn" (dòng "Người duyệt gần nhất").
    await expect(
      page.locator('.adm-content-workflow').getByText(/^Bạn · /u),
    ).toBeVisible();
    await expect(publishButton).toBeEnabled();
    await publishButton.click();
    await expect(
      page.locator('.adm-badge--ok', { hasText: 'Đã xuất bản' }).first(),
    ).toBeVisible();
  });

  test('flow 4: xuất bản bài học thiếu chủ đề đã xuất bản → lỗi → xuất bản được sau khi chủ đề lên', async ({
    page,
  }, testInfo) => {
    skipUnlessMain(testInfo);
    await loginAsAdmin(page);
    const lessonId = await createLesson(
      page,
      testInfo,
      `E2E publish ${suffix(testInfo)}`,
    );
    lessonsToArchive.add(lessonId);

    // Duyệt bản sửa lesson, publish → LESSON_NO_PUBLISHED_CHILD tiếng Việt.
    await page.goto(`/admin/content/lessons/${lessonId}`);
    await page.getByRole('radio', { name: 'Duyệt' }).check();
    await page.getByRole('button', { name: 'Gửi đánh giá' }).click();
    const publishButton = page.getByRole('button', { name: 'Xuất bản' });
    await expect(publishButton).toBeEnabled();
    await publishButton.click();
    await expect(page.locator('p[role="alert"]')).toContainText(
      /ít nhất một chủ đề hoặc truyện đã xuất bản/u,
    );

    // Tạo + duyệt + xuất bản chủ đề con.
    const topicId = await createTopicViaUi(
      page,
      lessonId,
      `Chủ đề publish ${suffix(testInfo)}`,
    );
    await page.goto(`/admin/content/topics/${topicId}`);
    await approveAndPublish(page);

    // Quay lại lesson → publish thành công.
    await page.goto(`/admin/content/lessons/${lessonId}`);
    const publishAgain = page.getByRole('button', { name: 'Xuất bản' });
    await expect(publishAgain).toBeEnabled();
    await publishAgain.click();
    await expect(
      page.locator('.adm-badge--ok', { hasText: 'Đã xuất bản' }).first(),
    ).toBeVisible();

    // Dọn sau publish: archive luôn lesson — vừa test archive lesson, vừa
    // giữ lesson e2e khỏi lộ trình learner (lesson HSK1 đã publish phá
    // learner-web F4 tab order khi suite chạy chung một DB).
    await page.getByRole('button', { name: 'Lưu trữ', exact: true }).click();
    await page.getByRole('button', { name: 'Xác nhận lưu trữ' }).click();
    await expect(
      page.getByText('Đã lưu trữ — không thể thay đổi.'),
    ).toBeVisible();

    // R8: bài đã lưu trữ ẩn "Thêm chủ đề" + nút lưu; tạo chủ đề dưới bài
    // đã lưu trữ bị chặn 404 (notFound trước khi gọi backend).
    await expect(page.getByRole('link', { name: 'Thêm chủ đề' })).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Lưu bản sửa' }),
    ).toBeHidden();
    const archivedNew = await page.goto(
      `/admin/content/topics/new?lessonId=${lessonId}`,
    );
    // Root not-found toàn cục: segment topics/new không có not-found riêng.
    // (Next streaming trả HTTP 200 — nhận biết bằng nội dung 404.)
    expect(await archivedNew?.text()).toContain('Page not found');
    await expect(page.getByRole('button', { name: 'Tạo chủ đề' })).toHaveCount(
      0,
    );
  });

  test('R1: chủ đề đã xuất bản + bản sửa chờ duyệt → form điền từ bản sửa', async ({
    page,
  }, testInfo) => {
    skipUnlessMain(testInfo);
    await loginAsAdmin(page);
    const lessonId = await createLesson(
      page,
      testInfo,
      `E2E prefill ${suffix(testInfo)}`,
    );
    const liveTitle = `Chủ đề live ${suffix(testInfo)}`;
    const topicId = await createTopicViaUi(page, lessonId, liveTitle);
    await page.goto(`/admin/content/topics/${topicId}`);
    await approveAndPublish(page);

    const revisionTitle = `Chủ đề bản sửa ${suffix(testInfo)}`;
    await page.getByLabel(/Tiêu đề/u).fill(revisionTitle);
    await page.getByRole('button', { name: 'Lưu bản sửa' }).click();
    await expect(page.locator('.adm-flow [aria-current="step"]')).toContainText(
      'Gửi duyệt',
    );

    await page.reload();
    // Bản live giữ tiêu đề cũ (h1), form điền từ snapshot bản sửa mới nhất.
    await expect(
      page.getByRole('heading', { level: 1, name: liveTitle }),
    ).toBeVisible();
    await expect(page.getByLabel(/Tiêu đề/u)).toHaveValue(revisionTitle);
  });

  test('flow 5: lưu trữ chủ đề có xác nhận inline → mọi thao tác ẩn', async ({
    page,
  }, testInfo) => {
    skipUnlessMain(testInfo);
    await loginAsAdmin(page);
    const lessonId = await createLesson(
      page,
      testInfo,
      `E2E archive ${suffix(testInfo)}`,
    );
    const topicId = await createTopicViaUi(
      page,
      lessonId,
      `Chủ đề archive ${suffix(testInfo)}`,
    );

    await page.goto(`/admin/content/topics/${topicId}`);
    await page.getByRole('button', { name: 'Lưu trữ', exact: true }).click();
    // Xác nhận inline (không modal); Huỷ giữ nguyên.
    await page.getByRole('button', { name: 'Huỷ' }).click();
    await expect(
      page.getByRole('button', { name: 'Xác nhận lưu trữ' }),
    ).toBeHidden();
    await page.getByRole('button', { name: 'Lưu trữ', exact: true }).click();
    await page.getByRole('button', { name: 'Xác nhận lưu trữ' }).click();

    await expect(
      page.getByText('Đã lưu trữ — không thể thay đổi.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Xuất bản' })).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Gửi đánh giá' }),
    ).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Lưu bản sửa' }),
    ).toBeHidden();
  });

  test('R9: id route không hợp lệ → not-found trước khi gọi backend', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    // Next.js streaming: notFound() trong lúc stream trả HTTP 200 nhưng nội
    // dung là not-found boundary gần nhất (assert nội dung).
    for (const [url, heading] of [
      ['/admin/content/lessons/0', 'Không tìm thấy bài học'],
      ['/admin/content/lessons/01', 'Không tìm thấy bài học'],
      ['/admin/content/lessons/2147483648', 'Không tìm thấy bài học'],
      ['/admin/content/topics/0', 'Không tìm thấy chủ đề'],
      ['/admin/content/topics/01', 'Không tìm thấy chủ đề'],
      ['/admin/content/topics/2147483648', 'Không tìm thấy chủ đề'],
    ] as const) {
      await page.goto(url);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }
  });

  test('flow 6: POST chéo origin vào BFF nội dung → 403, không chạm backend', async ({
    page,
  }) => {
    for (const path of [
      '/api/admin/content/lessons',
      '/api/admin/content/topics',
      '/api/admin/content/lessons/1/revisions/1/publish',
      '/api/admin/content/topics/1/archive',
    ]) {
      const response = await page.request.post(path, {
        headers: { origin: 'https://attacker.example' },
        data: {},
      });
      expect(response.status()).toBe(403);
      expect(response.headers()['cache-control']).toBe('no-store');
    }
  });

  test('flow 7: axe 0 vi phạm trên trang tạo/sửa lesson và topic', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const ids = queryDisposableDb(
      'SELECT (SELECT id FROM "Lesson" WHERE slug = \'numbers-counting\'), ' +
        '(SELECT id FROM "Topic" WHERE title = \'Numbers 1–10\')',
    ).split(/[|\n]/u);

    for (const url of [
      '/admin/content/lessons/new',
      `/admin/content/lessons/${ids[0]?.trim()}`,
      `/admin/content/topics/new?lessonId=${ids[0]?.trim()}`,
      `/admin/content/topics/${ids[1]?.trim()}`,
    ]) {
      await page.goto(url);
      await page.locator('main').first().waitFor();
      const accessibility = await new AxeBuilder({ page })
        .include('main')
        .analyze();
      expect(
        accessibility.violations,
        `axe violations on ${url}: ${JSON.stringify(accessibility.violations.map((v) => v.id))}`,
      ).toEqual([]);
    }
  });
});
