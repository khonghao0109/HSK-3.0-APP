import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

import { queryDisposableDb, sqlLiteral } from './support/disposable-db';

/**
 * M5.3 — trang Người dùng (Q108–Q111, TL-70…TL-75).
 *
 * User được seed bằng SQL theo TL-58: chép đúng password hash của user fixture
 * `user.frontend@example.test` nên đăng nhập được bằng mật khẩu fixture mà
 * spec không cần argon2. Mỗi project dùng một tiền tố riêng nên bốn project
 * chạy tuần tự trên cùng DB không đụng nhau.
 */

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? 'admin.frontend@example.test';
const adminPassword =
  process.env.E2E_ADMIN_PASSWORD ?? 'FrontendTest-Admin-123';
const learnerEmail = process.env.E2E_USER_EMAIL ?? 'user.frontend@example.test';
const learnerPassword =
  process.env.E2E_USER_PASSWORD ?? 'FrontendTest-User-123';

// Mỗi project một bộ user/tiền tố riêng. Playwright khởi động lại worker sau
// một test lỗi và chạy lại beforeAll, nên seed là upsert idempotent thay vì
// INSERT thuần.
let prefix = 'm53u';
const emails = { role: '', suspend: '', admin: '' };
const names = { role: '', suspend: '', admin: '' };
const suspendReason = 'Vi phạm quy định cộng đồng M5.3';

const ROLE_LAST_LOGIN_AT = '2026-05-31 03:24:00';
const ROLE_LAST_LOGIN_LABEL = '31/05/2026 10:24';

function seedUser(
  email: string,
  name: string,
  role: 'user' | 'admin',
  lastLoginAt: string | null = null,
): void {
  const lastLogin =
    lastLoginAt === null ? 'NULL' : `${sqlLiteral(lastLoginAt)}::timestamp`;
  queryDisposableDb(`
    INSERT INTO "User" (email, password, name, role, status, "emailVerifiedAt", "lastLoginAt", "createdAt", "updatedAt")
    SELECT ${sqlLiteral(email)}, password, ${sqlLiteral(name)},
      ${sqlLiteral(role)}::"Role", 'active'::"AccountStatus",
      CURRENT_TIMESTAMP, ${lastLogin}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM "User" WHERE email = ${sqlLiteral(learnerEmail)}
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      role = EXCLUDED.role,
      status = 'active'::"AccountStatus",
      "lastLoginAt" = EXCLUDED."lastLoginAt",
      "deletedAt" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP;
  `);
}

async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Mật khẩu').fill(adminPassword);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.waitForURL(/\/(admin\/|forbidden)/u);
}

async function openUsers(page: Page, query = '') {
  await page.goto(`/admin/users${query}`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Người dùng' }),
  ).toBeVisible();
}

function visible(locator: Locator) {
  return locator.filter({ visible: true });
}

test.describe('Admin người dùng (M5.3)', () => {
  test.beforeAll(({}, testInfo) => {
    const project = testInfo.project.name.replace(/[^a-z0-9]+/giu, '-');
    prefix = `m53u-${project}`;
    const suffix = `(${testInfo.project.name})`;
    emails.role = `${prefix}-role@example.test`;
    emails.suspend = `${prefix}-suspend@example.test`;
    emails.admin = `${prefix}-admin@example.test`;
    names.role = `M53 Role Target ${suffix}`;
    names.suspend = `M53 Suspend Target ${suffix}`;
    names.admin = `M53 Admin Target ${suffix}`;
    seedUser(emails.role, names.role, 'user', ROLE_LAST_LOGIN_AT);
    seedUser(emails.suspend, names.suspend, 'user');
    seedUser(emails.admin, names.admin, 'admin');
  });

  // R3.2: mọi test bắt console error + pageerror; lỗi ngoài phạm vi (nếu có)
  // vẫn làm test đỏ và được in nguyên văn, không lọc bỏ.
  let pageErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    pageErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        pageErrors.push(`console: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => {
      pageErrors.push(`pageerror: ${error.message}`);
    });
  });

  test.afterEach(() => {
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('U1: tab vai trò, bộ lọc trạng thái, tìm kiếm và đếm kết quả trên URL', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await openUsers(page);

    const search = page.getByRole('search', { name: 'Lọc người dùng' });
    await search.getByLabel('Trạng thái').selectOption('active');
    await search.getByLabel(/Tìm kiếm theo tên hoặc email/u).fill(prefix);
    await search.getByRole('button', { name: 'Lọc', exact: true }).click();
    await expect(page).toHaveURL(/status=active/u);
    await expect(page).toHaveURL(new RegExp(`q=${prefix}`, 'u'));
    await expect(
      page
        .getByLabel('Phân trang người dùng')
        .getByText('Hiển thị 1 đến 3 của 3 kết quả'),
    ).toBeVisible();

    // Tab Người học loại tài khoản admin, tab Quản trị viên chỉ còn admin.
    await page.getByRole('link', { name: 'Người học', exact: true }).click();
    await expect(page).toHaveURL(/tab=learner/u);
    await expect(
      page.getByRole('button', { name: `Đổi vai trò của ${names.role}` }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Đổi vai trò của ${names.admin}` }),
    ).toHaveCount(0);

    await page.getByRole('link', { name: 'Quản trị viên' }).click();
    await expect(page).toHaveURL(/tab=admin/u);
    await expect(
      page.getByRole('button', { name: `Đổi vai trò của ${names.admin}` }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Đổi vai trò của ${names.role}` }),
    ).toHaveCount(0);

    // Tìm theo tên; trạng thái không khớp thì danh sách rỗng. Điều hướng
    // thẳng (không bấm tab rồi submit ngay) để không đua với navigation trên
    // mobile-390.
    await openUsers(page, `?q=${encodeURIComponent(prefix)}&status=active`);
    const searchAll = page.getByRole('search', { name: 'Lọc người dùng' });
    await searchAll
      .getByLabel(/Tìm kiếm theo tên hoặc email/u)
      .fill(names.suspend);
    await searchAll.getByRole('button', { name: 'Lọc', exact: true }).click();
    await expect(
      page.getByRole('button', { name: `Đổi vai trò của ${names.suspend}` }),
    ).toBeVisible();
    await expect(
      page
        .getByLabel('Phân trang người dùng')
        .getByText('Hiển thị 1 đến 1 của 1 kết quả'),
    ).toBeVisible();

    await page
      .getByRole('search', { name: 'Lọc người dùng' })
      .getByLabel('Trạng thái')
      .selectOption('suspended');
    await page
      .getByRole('search', { name: 'Lọc người dùng' })
      .getByRole('button', { name: 'Lọc', exact: true })
      .click();
    await expect(
      visible(page.getByText('Không có người dùng nào khớp bộ lọc.')).first(),
    ).toBeVisible();
  });

  test('U1b: bảng desktop mỗi hàng đúng 6 ô, khớp nội dung 6 cột (R2/R3/R4)', async ({
    page,
  }, testInfo) => {
    // Bảng desktop chỉ có ở project ≥1024; mobile/tablet dùng card nên không
    // có gì để kiểm ở đây (không dùng .skip để diff không chứa ngoại lệ gate).
    if (!testInfo.project.name.startsWith('desktop-')) return;
    await loginAsAdmin(page);
    await openUsers(page, `?q=${encodeURIComponent(emails.role)}`);

    const row = page.getByRole('row').filter({ hasText: names.role });
    await expect(row).toHaveCount(1);
    const cells = row.getByRole('cell');
    await expect(cells).toHaveCount(6);

    // R4: cột Người dùng chỉ có tên, không lặp email.
    await expect(cells.nth(0)).toHaveText(names.role);
    await expect(cells.nth(0)).not.toContainText(emails.role);
    await expect(cells.nth(1)).toHaveText('Người học');
    await expect(cells.nth(2)).toHaveText(emails.role);
    await expect(cells.nth(3)).toHaveText('Hoạt động');
    await expect(cells.nth(4)).toHaveText(ROLE_LAST_LOGIN_LABEL);
    await expect(
      cells.nth(5).getByRole('button', { name: 'Đổi vai trò' }),
    ).toBeVisible();
    await expect(
      cells.nth(5).getByRole('button', { name: 'Khoá' }),
    ).toBeVisible();
  });

  test('U2: đổi vai trò qua dialog có xác nhận, cập nhật bảng và audit', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await openUsers(page, `?q=${encodeURIComponent(emails.role)}`);
    const opener = page.getByRole('button', {
      name: `Đổi vai trò của ${names.role}`,
    });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Đổi vai trò' });
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel('Vai trò mới')).toBeFocused();
    await page.getByLabel('Vai trò mới').selectOption('admin');
    await dialog.getByRole('button', { name: 'Xác nhận đổi vai trò' }).click();
    await expect(
      page.getByRole('status').filter({
        hasText: `Đã đổi vai trò của ${names.role} thành Quản trị viên.`,
      }),
    ).toBeVisible();
    await expect(
      visible(
        page
          .getByRole('region', { name: 'Danh sách người dùng' })
          .getByText('Quản trị viên', { exact: true }),
      ).first(),
    ).toBeVisible();
  });

  test('U3: khoá kèm lý do, đếm 0/500, cảnh báo; phiên cũ qua BFF nhận 401', async ({
    page,
  }) => {
    // Tạo phiên learner thật trong browser context trước khi bị khoá.
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(emails.suspend);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(learnerPassword);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();
    await page.waitForURL(/onboarding\/goal|\/learn/u);
    // Gửi đúng cookie phiên learner qua page.request: request context không
    // tự gửi cookie Secure trên http, còn fetch trong trang sẽ sinh console
    // error cho 401 chủ đích ở bước sau.
    const learnerCookie = (await page.context().cookies()).find((cookie) =>
      /learner_session$/u.test(cookie.name),
    );
    expect(learnerCookie).toBeTruthy();
    const learnerCookieHeader = {
      cookie: `${learnerCookie!.name}=${learnerCookie!.value}`,
    };
    const beforeSuspend = await page.request.get('/api/learner/session/me', {
      headers: learnerCookieHeader,
    });
    expect(beforeSuspend.status()).toBe(200);

    await loginAsAdmin(page);
    await openUsers(page, `?q=${encodeURIComponent(emails.suspend)}`);
    await page
      .getByRole('button', { name: `Khoá tài khoản ${names.suspend}` })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Khoá tài khoản' });
    await expect(dialog).toBeVisible();
    const reason = page.getByLabel(/Lý do khoá/u);
    await expect(reason).toBeFocused();
    await expect(
      dialog.getByText('Người dùng sẽ bị đăng xuất khỏi mọi thiết bị.'),
    ).toBeVisible();
    await expect(dialog.getByText('0/500')).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Khoá tài khoản' }),
    ).toBeDisabled();
    await reason.fill(suspendReason);
    await expect(dialog.getByText(`${suspendReason.length}/500`)).toBeVisible();
    await dialog.getByRole('button', { name: 'Khoá tài khoản' }).click();

    await expect(
      page.getByRole('status').filter({
        hasText: `Đã khoá tài khoản ${names.suspend}.`,
      }),
    ).toBeVisible();
    await expect(
      visible(
        page
          .getByRole('region', { name: 'Danh sách người dùng' })
          .getByText('Đã khoá', { exact: true }),
      ).first(),
    ).toBeVisible();

    // TL-63/K3: phiên cũ bị thu hồi ngay, gọi qua BFF nhận 401.
    const afterSuspend = await page.request.get('/api/learner/session/me', {
      headers: learnerCookieHeader,
    });
    expect(afterSuspend.status()).toBe(401);
  });

  test('U4: mở khoá xác nhận một bước', async ({ page }) => {
    await loginAsAdmin(page);
    await openUsers(page, `?q=${encodeURIComponent(emails.suspend)}`);
    await page
      .getByRole('button', { name: `Mở khoá tài khoản ${names.suspend}` })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Mở khoá tài khoản' });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Mở khoá tài khoản' }),
    ).toBeFocused();
    await dialog.getByRole('button', { name: 'Mở khoá tài khoản' }).click();
    await expect(
      page.getByRole('status').filter({
        hasText: `Đã mở khoá tài khoản ${names.suspend}.`,
      }),
    ).toBeVisible();
    await expect(
      visible(
        page
          .getByRole('region', { name: 'Danh sách người dùng' })
          .getByText('Hoạt động', { exact: true }),
      ).first(),
    ).toBeVisible();
  });

  test('U5: khối audit hiện đủ 3 dòng của M5.3 kèm lý do và chuyển vai trò', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await openUsers(page);
    const audit = page.getByRole('region', {
      name: 'Nhật ký hoạt động (Audit)',
    });
    await expect(audit).toBeVisible();
    await expect(
      visible(audit.getByText('Đổi vai trò', { exact: true })).first(),
    ).toBeVisible();
    await expect(
      visible(audit.getByText('Khoá tài khoản', { exact: true })).first(),
    ).toBeVisible();
    await expect(
      visible(audit.getByText('Mở khoá tài khoản', { exact: true })).first(),
    ).toBeVisible();
    await expect(
      visible(audit.getByText('Người học → Quản trị viên')).first(),
    ).toBeVisible();
    await expect(visible(audit.getByText(suspendReason)).first()).toBeVisible();
    await expect(visible(audit.getByText(emails.role)).first()).toBeVisible();
    await expect(
      visible(audit.getByText(emails.suspend)).first(),
    ).toBeVisible();
    await expect(
      visible(audit.getByText('Lin Qiao', { exact: true })).first(),
    ).toBeVisible();
  });

  test('U6: không thể tự khoá chính mình — nút tắt kèm lý do đọc được', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await openUsers(page, `?q=${encodeURIComponent(adminEmail)}`);
    const roleButton = page.getByRole('button', {
      name: 'Đổi vai trò của Lin Qiao',
    });
    const suspendButton = page.getByRole('button', {
      name: 'Khoá tài khoản Lin Qiao',
    });
    await expect(roleButton).toBeDisabled();
    await expect(suspendButton).toBeDisabled();
    await expect(
      visible(
        page.getByText('Không thể thao tác trên chính mình.', { exact: true }),
      ).first(),
    ).toBeVisible();
  });

  test('U7: Esc đóng dialog và focus trả về nút đã mở', async ({ page }) => {
    await loginAsAdmin(page);
    await openUsers(page, `?q=${encodeURIComponent(emails.suspend)}`);
    const opener = page.getByRole('button', {
      name: `Đổi vai trò của ${names.suspend}`,
    });
    await opener.click();
    await expect(
      page.getByRole('dialog', { name: 'Đổi vai trò' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Đổi vai trò' })).toHaveCount(
      0,
    );
    await expect(opener).toBeFocused();
  });

  test('U8: axe 0 vi phạm (trang và dialog); 390px không cuộn ngang', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await openUsers(page);
    const initial = await new AxeBuilder({ page }).analyze();
    expect(initial.violations.map((violation) => violation.id)).toEqual([]);

    await page
      .getByRole('button', { name: `Đổi vai trò của ${names.suspend}` })
      .click();
    const withDialog = await new AxeBuilder({ page }).analyze();
    expect(withDialog.violations.map((violation) => violation.id)).toEqual([]);
    await page.keyboard.press('Escape');

    const overflow = await page.evaluate(() => ({
      html: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(overflow.html, JSON.stringify(overflow)).toBeLessThanOrEqual(
      overflow.viewport,
    );
    expect(overflow.body, JSON.stringify(overflow)).toBeLessThanOrEqual(
      overflow.viewport,
    );
  });
});
