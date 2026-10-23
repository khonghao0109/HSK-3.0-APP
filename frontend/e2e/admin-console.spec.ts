import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { disposableDbUrl, queryDisposableDb } from './support/disposable-db';

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? 'admin.frontend@example.test';
const adminPassword =
  process.env.E2E_ADMIN_PASSWORD ?? 'FrontendTest-Admin-123';
const userEmail = process.env.E2E_USER_EMAIL ?? 'user.frontend@example.test';
const userPassword = process.env.E2E_USER_PASSWORD ?? 'FrontendTest-User-123';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function captureConsoleIssues(page: Page): string[] {
  const issues: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      issues.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    issues.push(`pageerror: ${error.message}`);
  });
  return issues;
}

type HorizontalOverflowMetrics = {
  bodyScrollWidth: number;
  htmlScrollWidth: number;
  innerWidth: number;
  scrollHeight: number;
  overflowElements: string[];
};

async function assertNoHorizontalOverflow(
  page: Page,
): Promise<HorizontalOverflowMetrics> {
  const metrics = await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const overflowElements = Array.from(document.body.querySelectorAll('*'))
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.left < -0.5 || bounds.right > viewportWidth + 0.5;
      })
      .slice(0, 12)
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        const name = element.tagName.toLowerCase();
        const identity = element.id
          ? `#${element.id}`
          : element.classList.length > 0
            ? `.${Array.from(element.classList).join('.')}`
            : '';
        return `${name}${identity} [${bounds.left.toFixed(1)}, ${bounds.right.toFixed(1)}]`;
      });

    return {
      bodyScrollWidth: document.body.scrollWidth,
      htmlScrollWidth: document.documentElement.scrollWidth,
      innerWidth: viewportWidth,
      scrollHeight: document.documentElement.scrollHeight,
      overflowElements,
    };
  });

  const evidence = JSON.stringify(metrics);
  expect(metrics.htmlScrollWidth, evidence).toBeLessThanOrEqual(
    metrics.innerWidth,
  );
  expect(metrics.bodyScrollWidth, evidence).toBeLessThanOrEqual(
    metrics.innerWidth,
  );
  return metrics;
}

async function assertLoginActionsVisible(page: Page) {
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Mật khẩu')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Đăng nhập' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Về trang Bài tập' }),
  ).toBeVisible();
}

async function assertLoginLayout(page: Page) {
  const metrics = await assertNoHorizontalOverflow(page);
  await expect(page.locator('.adm-state-card')).toBeInViewport();
  await assertLoginActionsVisible(page);
  return metrics;
}

const loginBoundaryWidths = [
  768, 320, 760, 761, 767, 839, 840, 841, 1024, 1440,
];
const exerciseDetailBoundaryWidths = [320, 390, 430, 760, 768, 1024, 1440];

test('keeps login routes inside every responsive boundary', async ({
  page,
}, testInfo: TestInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-1440',
    'The boundary matrix is exercised once; each project covers its native viewport separately.',
  );

  for (const width of loginBoundaryWidths) {
    await page.setViewportSize({ width, height: width >= 1024 ? 900 : 1024 });
    await page.goto('/login');
    const loginMetrics = await assertLoginLayout(page);
    expect(loginMetrics.innerWidth).toBe(width);

    await page.goto('/login?reason=session');
    const sessionMetrics = await assertLoginLayout(page);
    expect(sessionMetrics.innerWidth).toBe(width);
  }
});

test('keeps session recovery pending and retry states inside the login viewport', async ({
  page,
}) => {
  await page.goto('/login');
  await assertLoginLayout(page);

  const recoveryRequested = deferred();
  const releaseRecovery = deferred();
  const recoveryCompleted = deferred();
  await page.route('**/api/session/recover', async (route) => {
    recoveryRequested.resolve();
    await releaseRecovery.promise;
    await route.fulfill({
      status: 204,
      headers: { 'x-session-recovery': 'ready' },
    });
    recoveryCompleted.resolve();
  });
  await page.goto('/login?reason=session');
  await recoveryRequested.promise;
  await expect(
    page.getByText('Phiên đã kết thúc. Đăng nhập lại để tiếp tục.'),
  ).toBeVisible();
  await assertLoginLayout(page);
  releaseRecovery.resolve();
  await recoveryCompleted.promise;
  await page.unroute('**/api/session/recover');

  await page.route('**/api/session/recover', async (route) => {
    await route.fulfill({ status: 503 });
  });
  await page.goto('/login?reason=session');
  await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await assertLoginActionsVisible(page);
});

async function login(page: Page, email = adminEmail, password = adminPassword) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.waitForURL(/\/(admin\/exercises|forbidden)/);
}

test('serves a strict per-request production CSP and redirects anonymous admin access', async ({
  page,
  request,
}) => {
  const first = await request.get('/login');
  const second = await request.get('/login');
  const firstPolicy = first.headers()['content-security-policy'];
  const secondPolicy = second.headers()['content-security-policy'];
  const firstNonce = firstPolicy?.match(/'nonce-([^']+)'/u)?.[1];
  const secondNonce = secondPolicy?.match(/'nonce-([^']+)'/u)?.[1];

  expect(firstPolicy).toBeTruthy();
  expect(firstPolicy).not.toContain("script-src 'self' 'unsafe-inline'");
  expect(firstPolicy).not.toContain("'unsafe-eval'");
  expect(firstPolicy).toContain("media-src 'self'");
  expect(firstPolicy).not.toContain('media-src https:');
  expect(firstNonce).toMatch(/^[A-Za-z0-9+/]{24}$/u);
  expect(secondNonce).toMatch(/^[A-Za-z0-9+/]{24}$/u);
  expect(firstNonce).not.toBe(secondNonce);
  expect(first.headers()['strict-transport-security']).toBeTruthy();
  expect(first.headers()['x-content-type-options']).toBe('nosniff');
  expect(first.headers()['referrer-policy']).toBe(
    'strict-origin-when-cross-origin',
  );
  expect(first.headers()['permissions-policy']).toBeTruthy();
  expect(first.headers()['x-frame-options']).toBe('DENY');

  const untrustedHost = await request.get('/admin/exercises', {
    headers: {
      host: 'localhost:3200',
      'x-forwarded-host': 'localhost:3200',
    },
    maxRedirects: 0,
  });
  expect(untrustedHost.status()).toBe(307);
  expect(untrustedHost.headers().location).toBe(
    'http://127.0.0.1:3200/login?reason=session',
  );

  const api = await request.get('/api/session/me');
  expect(api.status()).toBe(401);
  expect(api.headers()['content-security-policy']).toBeUndefined();
  expect(api.headers()['x-content-type-options']).toBe('nosniff');

  const prefetchHeaders: Record<string, string>[] = [
    { purpose: 'prefetch' },
    { 'next-router-prefetch': '1' },
  ];
  for (const headers of prefetchHeaders) {
    const prefetch = await request.get('/login', { headers });
    expect(prefetch.status()).toBe(200);
    expect(prefetch.headers()['content-security-policy']).toBeUndefined();
    expect(prefetch.headers()['x-content-type-options']).toBe('nosniff');
  }

  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible();
  await page.goto('/admin/exercises');
  await expect(page).toHaveURL('http://127.0.0.1:3200/login?reason=session');
  expect(consoleErrors).toEqual([]);
});

test('keeps the back-to-exercises link client navigation RSC-safe and canonical', async ({
  page,
  context,
}) => {
  const consoleIssues: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleIssues.push(`${message.type()}: ${message.text()}`);
    }
  });

  await page.goto('/login');
  await context.addCookies([
    {
      name: 'hsk_admin_session',
      value: 'invalid-session-token',
      url: 'http://127.0.0.1:3200',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  expect(
    (await context.cookies()).some(
      (cookie) => cookie.name === 'hsk_admin_session',
    ),
  ).toBe(true);
  await expect(
    page.getByRole('link', { name: 'Về trang Bài tập' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Về trang Bài tập' }).click();
  await page.waitForURL(/\/login\?reason=session$/u);
  expect(consoleIssues).toEqual([]);
  expect(new URL(page.url()).origin).toBe('http://127.0.0.1:3200');
  await expect
    .poll(async () =>
      (await context.cookies()).some(
        (cookie) => cookie.name === 'hsk_admin_session',
      ),
    )
    .toBe(false);
});

test('serializes a pending cookie clear before login creates a new session', async ({
  page,
  context,
}) => {
  const consoleIssues = captureConsoleIssues(page);
  const recoveryRequested = deferred();
  const releaseRecovery = deferred();
  let recoveryReleased = false;
  const requestOrder: string[] = [];

  await context.addCookies([
    {
      name: 'hsk_admin_session',
      value: 'invalid-session-token',
      url: 'http://127.0.0.1:3200',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  await page.route('**/api/session/recover', async (route) => {
    requestOrder.push('recover');
    recoveryRequested.resolve();
    await releaseRecovery.promise;
    await route.fulfill({
      status: 204,
      headers: { 'x-session-recovery': 'invalid' },
    });
  });
  await page.route('**/api/session/logout', async (route) => {
    requestOrder.push('logout');
    expect(recoveryReleased).toBe(true);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'cache-control': 'no-store',
        'set-cookie':
          'hsk_admin_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
      },
      body: JSON.stringify({ success: true }),
    });
  });
  await page.route('**/api/session/login', async (route) => {
    requestOrder.push('login');
    expect(recoveryReleased).toBe(true);
    await route.continue();
  });

  await page.goto('/login?reason=session');
  await recoveryRequested.promise;
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Mật khẩu').fill(adminPassword);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(
    page.getByRole('button', { name: 'Đang kiểm tra phiên…' }),
  ).toBeDisabled();
  await expect(page.getByLabel('Email')).toHaveValue(adminEmail);
  await expect(page.getByLabel('Mật khẩu')).toHaveValue(adminPassword);
  expect(requestOrder).toEqual(['recover']);

  recoveryReleased = true;
  releaseRecovery.resolve();

  await expect(page).toHaveURL(/\/admin\/exercises/u);
  const freshCookie = (await context.cookies()).find(
    (cookie) => cookie.name === 'hsk_admin_session',
  );
  expect(freshCookie?.value).toBeTruthy();
  expect(freshCookie?.value).not.toBe('invalid-session-token');
  expect(requestOrder).toEqual(['recover', 'logout', 'login']);
  expect(consoleIssues).toEqual([]);
});

test('a stale recovery response cannot mutate a fresh login cookie', async ({
  page,
  context,
}) => {
  const consoleIssues = captureConsoleIssues(page);
  const recoveryRequested = deferred();
  const releaseRecovery = deferred();

  await context.addCookies([
    {
      name: 'hsk_admin_session',
      value: 'invalid-session-token',
      url: 'http://127.0.0.1:3200',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  await page.route('**/api/session/recover', async (route) => {
    recoveryRequested.resolve();
    await releaseRecovery.promise;
    await route.fulfill({
      status: 204,
      headers: {
        'cache-control': 'no-store',
        'x-session-recovery': 'invalid',
      },
    });
  });
  await page.goto('/login');
  await page.evaluate(() => {
    void fetch('/api/session/recover', {
      method: 'POST',
      credentials: 'same-origin',
    });
  });
  await recoveryRequested.promise;
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Mật khẩu').fill(adminPassword);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).toHaveURL(/\/admin\/exercises/u);
  const cookieBeforeStaleResponse = (await context.cookies()).find(
    (cookie) => cookie.name === 'hsk_admin_session',
  );
  expect(cookieBeforeStaleResponse?.value).toBeTruthy();
  expect(cookieBeforeStaleResponse?.value).not.toBe('invalid-session-token');

  releaseRecovery.resolve();

  await expect
    .poll(
      async () =>
        (await context.cookies()).find(
          (cookie) => cookie.name === 'hsk_admin_session',
        )?.value,
    )
    .toBe(cookieBeforeStaleResponse?.value);
  expect(consoleIssues).toEqual([]);
});

test('protects deep links, persists an HttpOnly session, and logs out', async ({
  page,
  context,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/admin/exercises');
  await expect(page).toHaveURL(/\/login/);
  await login(page);
  await expect(page).toHaveURL(/\/admin\/exercises/);
  const cookie = (await context.cookies()).find(
    (item) => item.name === 'hsk_admin_session',
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Lax');
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Bài tập' })).toBeVisible();
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(consoleErrors).toEqual([]);
});

test('routes a current non-admin to forbidden without rendering admin data', async ({
  page,
}) => {
  await login(page, userEmail, userPassword);
  await expect(page).toHaveURL(/\/forbidden/);
  await expect(
    page.getByRole('heading', { name: 'Không có quyền truy cập' }),
  ).toBeVisible();
  await expect(page.getByText('Đáp án')).toHaveCount(0);
});

test('uses URL filters and server pagination, then opens a detail', async ({
  page,
}) => {
  // limit=1: one page per exercise. Learner specs add fixtures to the same
  // DB, so the seed's 3 is read from the table the list counts (no filter).
  const pages = Number(
    queryDisposableDb('SELECT count(*) FROM "LessonExercise"'),
  );
  expect(pages).toBeGreaterThanOrEqual(3);
  await login(page);
  await page.goto('/admin/exercises?limit=1&page=1');
  await expect(
    page.getByText(`Hiển thị 1 đến 1 của ${pages} kết quả`, { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Sau' }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(
    page.getByText(`Hiển thị 2 đến 2 của ${pages} kết quả`, { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Trạng thái').selectOption('published');
  await page.getByRole('button', { name: 'Lọc' }).click();
  await expect(page).toHaveURL(/status=published/);
  await page
    .getByRole('link', { name: /mở bài tập/i })
    .first()
    .click();
  // TL-18 (M5.1b1): trang chi tiết chỉ đọc được thay bằng trang sửa có form
  // từng loại; tiêu đề trang là đề bài nên chỉ cần h1 hiện ra.
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Nội dung bài tập', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Lịch sử bản sửa')).toBeVisible();
});

test('keeps the exercise revision hash readable inside every responsive boundary', async ({
  page,
}, testInfo: TestInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-1440',
    'The boundary matrix is exercised once; each project covers its native viewport separately.',
  );

  const consoleIssues = captureConsoleIssues(page);
  await login(page);

  for (const width of exerciseDetailBoundaryWidths) {
    await page.setViewportSize({ width, height: width >= 1024 ? 900 : 1024 });
    await page.goto('/admin/exercises/1');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

    const metrics = await assertNoHorizontalOverflow(page);
    expect(metrics.innerWidth).toBe(width);

    const revisionPanel = page.locator('.adm-panel').filter({
      has: page.getByRole('heading', { name: 'Lịch sử bản sửa' }),
    });
    const hash = revisionPanel.locator('.adm-hash');
    await expect(hash).toHaveCount(1);
    await expect(hash).toHaveText(/^[a-f0-9]{64}$/u);

    const [panelBox, hashBox, hashLayout] = await Promise.all([
      revisionPanel.boundingBox(),
      hash.boundingBox(),
      hash.evaluate((element) => {
        const styles = window.getComputedStyle(element);
        return {
          clientWidth: element.clientWidth,
          overflow: styles.overflow,
          overflowWrap: styles.overflowWrap,
          scrollWidth: element.scrollWidth,
          textOverflow: styles.textOverflow,
          whiteSpace: styles.whiteSpace,
        };
      }),
    ]);
    expect(panelBox).not.toBeNull();
    expect(hashBox).not.toBeNull();
    expect(hashBox!.x).toBeGreaterThanOrEqual(panelBox!.x - 0.5);
    expect(hashBox!.x + hashBox!.width).toBeLessThanOrEqual(
      panelBox!.x + panelBox!.width + 0.5,
    );
    expect(hashLayout.whiteSpace).not.toBe('nowrap');
    expect(hashLayout.overflow).not.toBe('hidden');
    expect(hashLayout.textOverflow).not.toBe('ellipsis');
    expect(hashLayout.scrollWidth).toBeLessThanOrEqual(
      hashLayout.clientWidth + 1,
    );

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  }

  expect(consoleIssues).toEqual([]);
});

test('matches the Hán Lộ Admin shell and adaptive inventory contract', async ({
  page,
}, testInfo: TestInfo) => {
  await login(page);
  await expect(page).toHaveURL(/\/admin\/exercises/u);
  await assertNoHorizontalOverflow(page);

  const sidebar = page.locator('.adm-sidebar');
  const desktopTable = page.locator('.adm-table');
  const compactList = page.getByRole('list', {
    name: 'Danh sách bài tập cho màn hẹp',
  });

  if (testInfo.project.name.startsWith('desktop-')) {
    await expect(sidebar).toBeVisible();
    const sidebarBox = await sidebar.boundingBox();
    expect(sidebarBox?.width).toBe(232);
    await expect(page.locator('.adm-topbar')).toBeVisible();
    await expect(desktopTable).toBeVisible();
    await expect(compactList).toBeHidden();
  } else {
    await expect(sidebar).toBeHidden();
    await expect(page.locator('.adm-topbar')).toBeVisible();
    await expect(desktopTable).toBeHidden();
    await expect(compactList).toBeVisible();

    const logoutBox = await page
      .getByRole('button', { name: 'Đăng xuất' })
      .boundingBox();
    expect(logoutBox?.width).toBeGreaterThanOrEqual(44);
    expect(logoutBox?.height).toBeGreaterThanOrEqual(44);
  }

  await expect(
    page.getByRole('button', { name: /tạo|xuất bản|nhập|tải lên/i }),
  ).toHaveCount(0);
});

test('M5.0 (a)(b)(c): khung sidebar desktop đúng mẫu 06, Q88/Q92/Q94', async ({
  page,
}, testInfo: TestInfo) => {
  test.skip(
    !testInfo.project.name.startsWith('desktop-'),
    'Khung desktop: chạy ở project desktop; drawer có test riêng ở ≤900px.',
  );
  await login(page);
  await expect(page).toHaveURL(/\/admin\/exercises/u);

  // (a) sidebar 232px nền navy-850; mục đang chọn nền jade-800 (Q92);
  // thanh trên 60px nền trắng.
  const frame = await page.evaluate(() => {
    const sidebar = document.querySelector('.adm-sidebar');
    const active = document.querySelector(
      '.adm-nav__item[aria-current="page"]',
    );
    const topbar = document.querySelector('.adm-topbar');
    if (!sidebar || !active || !topbar) return null;
    return {
      sidebarWidth: sidebar.getBoundingClientRect().width,
      sidebarBg: getComputedStyle(sidebar).backgroundColor,
      activeBg: getComputedStyle(active).backgroundColor,
      activeLabel: active.textContent,
      topbarHeight: topbar.getBoundingClientRect().height,
      topbarBg: getComputedStyle(topbar).backgroundColor,
    };
  });
  expect(frame).not.toBeNull();
  expect(frame!.sidebarWidth).toBe(232);
  expect(frame!.sidebarBg).toBe('rgb(10, 34, 74)');
  expect(frame!.activeLabel).toBe('Bài tập');
  expect(frame!.activeBg).toBe('rgb(6, 122, 96)');
  expect(frame!.topbarHeight).toBe(60);
  expect(frame!.topbarBg).toBe('rgb(255, 255, 255)');

  // (b) Q94: mục chưa có trang KHÔNG chip, không link, aria-disabled,
  // "Sắp có" trong tên đọc + title; mọi nhãn 1 dòng, mục cao ≤ 44px.
  // M5.1a: "Nội dung" đã có trang (/admin/content); M5.1b2 (TL-33):
  // "Nhập dữ liệu" có trang (/admin/import); M5.3: "Người dùng" có trang
  // (/admin/users), nên "Sắp có" giảm 9 → 6.
  const soonItems = page.locator('.adm-nav__item--soon');
  await expect(soonItems).toHaveCount(6);
  await expect(page.locator('.adm-nav__soon')).toHaveCount(0);
  await expect(soonItems.first()).toHaveAttribute('title', 'Sắp có');
  await expect(soonItems.first()).toHaveAccessibleName(/Sắp có/u);

  const navAudit = await page.locator('.adm-nav__item').evaluateAll((items) =>
    items.map((item) => {
      const label = item.querySelector('.adm-nav__label');
      return {
        tag: item.tagName,
        soon: item.classList.contains('adm-nav__item--soon'),
        ariaDisabled: item.getAttribute('aria-disabled'),
        title: item.getAttribute('title'),
        text: item.textContent ?? '',
        hasChip: item.querySelector('.adm-nav__soon') !== null,
        height: item.getBoundingClientRect().height,
        whiteSpace: label ? getComputedStyle(label).whiteSpace : null,
        scrollWidth: label?.scrollWidth ?? null,
        clientWidth: label?.clientWidth ?? null,
      };
    }),
  );
  expect(navAudit).toHaveLength(11);
  for (const item of navAudit) {
    expect(item.height).toBeLessThanOrEqual(44);
    expect(item.whiteSpace).toBe('nowrap');
    expect(item.scrollWidth).not.toBeNull();
    expect(item.scrollWidth!).toBeLessThanOrEqual(item.clientWidth!);
    expect(item.hasChip).toBe(false);
    if (item.soon) {
      expect(item.tag).not.toBe('A');
      expect(item.ariaDisabled).toBe('true');
      expect(item.title).toBe('Sắp có');
      expect(item.text).toContain('(Sắp có)');
    }
  }
  await expect(
    page.getByRole('link', { name: 'Báo cáo', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Người dùng', exact: true }),
  ).toHaveAttribute('href', '/admin/users');

  // (c) Thu gọn → sidebar 72px, aria-expanded=false, nhãn ẩn.
  const collapse = page.getByRole('button', { name: 'Thu gọn' });
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await collapse.click();
  await expect(collapse).toHaveAttribute('aria-expanded', 'false');
  const collapsed = await page.evaluate(() => {
    const sidebar = document.querySelector('.adm-sidebar');
    const label = document.querySelector('.adm-nav__label');
    if (!sidebar || !label) return null;
    return {
      sidebarWidth: sidebar.getBoundingClientRect().width,
      labelDisplay: getComputedStyle(label).display,
    };
  });
  expect(collapsed).not.toBeNull();
  expect(collapsed!.sidebarWidth).toBe(72);
  expect(collapsed!.labelDisplay).toBe('none');
  await collapse.click();
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
});

test('M5.0 (e): thanh trên không ô tìm kiếm, chuông, badge phản hồi (TL-7)', async ({
  page,
}) => {
  // R4: chạy ở cả 4 viewport (390/768/1024/1440).
  await login(page);
  await expect(page).toHaveURL(/\/admin\/exercises/u);

  const topbar = page.locator('.adm-topbar');
  await expect(topbar).toBeVisible();
  await expect(topbar.getByRole('search')).toHaveCount(0);
  await expect(topbar.getByRole('searchbox')).toHaveCount(0);
  await expect(topbar.locator('input')).toHaveCount(0);
  await expect(
    topbar.getByRole('button', { name: /thông báo|chuông/i }),
  ).toHaveCount(0);
  await expect(
    topbar.getByRole('link', { name: /thông báo|chuông|phản hồi/i }),
  ).toHaveCount(0);
  await expect(topbar.getByText(/phản hồi mới/i)).toHaveCount(0);
});

test('M5.0 (d): ≤900px nút menu mở drawer, Esc đóng và trả focus về nút (390 + 768)', async ({
  page,
}, testInfo: TestInfo) => {
  test.skip(
    !['mobile-390', 'tablet-768'].includes(testInfo.project.name),
    'Drawer là hành vi ≤900px: chạy ở mobile-390 và tablet-768.',
  );
  await login(page);
  await expect(page).toHaveURL(/\/admin\/exercises/u);

  const menu = page.getByRole('button', { name: 'Mở hoặc thu gọn menu' });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.adm-sidebar')).toBeHidden();

  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  const sidebar = page.locator('.adm-sidebar');
  // Chờ hết transition trượt (200ms) rồi mới đo.
  await page.waitForFunction(() => {
    const el = document.querySelector('.adm-sidebar');
    return el !== null && getComputedStyle(el).transform === 'none';
  });
  await expect(sidebar).toBeVisible();
  const drawerWidth = await sidebar.evaluate(
    (el) => el.getBoundingClientRect().width,
  );
  expect(drawerWidth).toBe(260);
  await expect(page.locator('.adm-backdrop')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();
  await expect(page.locator('.adm-backdrop')).toBeHidden();
});

test('navigates the secure Media library, filters assets and opens safe detail', async ({
  page,
  request,
}, testInfo: TestInfo) => {
  const consoleIssues = captureConsoleIssues(page);
  await login(page);
  // ≤900px sidebar là drawer đóng sẵn: mở bằng nút menu trước khi bấm mục.
  if (!testInfo.project.name.startsWith('desktop-')) {
    await page.getByRole('button', { name: 'Mở hoặc thu gọn menu' }).click();
    await page.waitForFunction(() => {
      const el = document.querySelector('.adm-sidebar');
      return el !== null && getComputedStyle(el).transform === 'none';
    });
  }
  const adminNavigation = page.getByRole('complementary', {
    name: 'Điều hướng quản trị',
  });
  await adminNavigation
    .getByRole('link', { name: 'Thư viện media', exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/media/u);
  await expect(
    page.getByRole('heading', { name: 'Thư viện media' }),
  ).toBeVisible();
  await assertNoHorizontalOverflow(page);

  await page.getByLabel('Loại', { exact: true }).selectOption('audio');
  await page.getByRole('button', { name: 'Lọc' }).click();
  await expect(page).toHaveURL(/type=audio/u);

  const desktopTable = page.locator('.adm-table');
  const compactList = page.getByRole('list', {
    name: 'Danh sách media cho màn hẹp',
  });
  if (testInfo.project.name.startsWith('desktop-')) {
    await expect(desktopTable).toBeVisible();
    await expect(compactList).toBeHidden();
    await expect(desktopTable.getByText('nihao-listening.mp3')).toBeVisible();
  } else {
    await expect(desktopTable).toBeHidden();
    await expect(compactList).toBeVisible();
    await expect(compactList.getByText('nihao-listening.mp3')).toBeVisible();
  }

  const mediaRecord = testInfo.project.name.startsWith('desktop-')
    ? desktopTable.getByRole('row').filter({
        hasText: 'nihao-listening.mp3',
      })
    : compactList.getByRole('listitem', { name: /media \d+/iu }).filter({
        hasText: 'nihao-listening.mp3',
      });
  await mediaRecord.getByRole('link', { name: /mở media \d+/iu }).click();
  await expect(
    page.getByRole('heading', { name: 'nihao-listening.mp3' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Thông tin kỹ thuật', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Tham chiếu', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Thao tác vòng đời', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/cdn\.example|private-test-provider|checksum-/i),
  ).toHaveCount(0);
  await assertNoHorizontalOverflow(page);

  const metadataFacts = page.locator('.adm-facts--two-col > div');
  const [typeFact, mimeFact] = await Promise.all([
    metadataFacts.nth(0).boundingBox(),
    metadataFacts.nth(1).boundingBox(),
  ]);
  expect(typeFact).not.toBeNull();
  expect(mimeFact).not.toBeNull();
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  if (viewportWidth > 760) {
    expect(
      mimeFact!.x - (typeFact!.x + typeFact!.width),
    ).toBeGreaterThanOrEqual(20);
    expect(Math.abs(mimeFact!.y - typeFact!.y)).toBeLessThanOrEqual(1);
  } else {
    const mimeRowSpacing = await metadataFacts.nth(1).evaluate((element) => {
      const styles = window.getComputedStyle(element);
      return {
        borderTopWidth: Number.parseFloat(styles.borderTopWidth),
        paddingTop: Number.parseFloat(styles.paddingTop),
      };
    });
    expect(mimeFact!.y).toBeGreaterThanOrEqual(typeFact!.y + typeFact!.height);
    expect(mimeRowSpacing.borderTopWidth).toBeGreaterThanOrEqual(1);
    expect(mimeRowSpacing.paddingTop).toBeGreaterThanOrEqual(10);
  }

  if (testInfo.project.name === 'desktop-1440') {
    const crossOrigin = await request.post(
      new URL(`${page.url()}/quarantine`)
        .toString()
        .replace(
          /\/admin\/media\/(\d+)\/quarantine/u,
          '/api/admin/media/$1/quarantine',
        ),
      { headers: { origin: 'https://attacker.example' } },
    );
    expect(crossOrigin.status()).toBe(403);
    // Ma trận M5.1b1 chạy 2 lần trên cùng DB: lượt đầu đã cách ly media seed
    // thì lượt sau nút bị tắt — khẳng định rõ trạng thái thay vì bỏ qua.
    const quarantine = page.getByRole('button', { name: 'Cách ly' });
    if (await quarantine.isEnabled()) {
      await quarantine.click();
    } else {
      await expect(quarantine).toBeDisabled();
    }
    await expect(page.getByText('Đã cách ly')).toBeVisible();
  }

  await expect(page).toHaveTitle(/Chi tiết media · Hán Lộ Admin/u);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  expect(consoleIssues).toEqual([]);
});

test('supports keyboard flow, responsive layout, and automated accessibility', async ({
  page,
}) => {
  await page.goto('/login');
  await assertLoginLayout(page);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Email')).toBeFocused();
  await page.getByLabel('Email').fill(adminEmail);
  await page.keyboard.press('Tab');
  await page.getByLabel('Mật khẩu').fill(adminPassword);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/exercises/);
  await expect(page).toHaveTitle(/Bài tập · Hán Lộ Admin/u);
  await expect(page.getByRole('heading', { name: 'Bài tập' })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('P-a: sets both session and refresh HttpOnly cookies on admin login', async ({
  page,
  context,
}) => {
  await login(page);
  await expect(page).toHaveURL(/\/admin\/exercises/);

  const cookies = await context.cookies();
  const sessionCookie = cookies.find((c) => c.name === 'hsk_admin_session');
  const refreshCookie = cookies.find(
    (c) => c.name === 'hsk_admin_session_refresh',
  );

  expect(sessionCookie).toBeTruthy();
  expect(sessionCookie?.httpOnly).toBe(true);
  expect(sessionCookie?.sameSite).toBe('Lax');

  expect(refreshCookie).toBeTruthy();
  expect(refreshCookie?.httpOnly).toBe(true);
  expect(refreshCookie?.sameSite).toBe('Lax');
});

test('P-b: transparently refreshes expired session on navigation and revokes on logout', async ({
  page,
  context,
}) => {
  // Fail fast before the UI steps if the database is not disposable.
  disposableDbUrl();
  await login(page);
  await expect(page).toHaveURL(/\/admin\/exercises/);

  const initialCookies = await context.cookies();
  const initialSession = initialCookies.find(
    (c) => c.name === 'hsk_admin_session',
  )?.value;
  const initialRefresh = initialCookies.find(
    (c) => c.name === 'hsk_admin_session_refresh',
  )?.value;

  expect(initialSession).toBeTruthy();
  expect(initialRefresh).toBeTruthy();

  const sessionParts = initialSession!.split('.');
  const sessionPayloadStr = sessionParts[1] ?? '';
  const payload = JSON.parse(
    Buffer.from(sessionPayloadStr, 'base64url').toString('utf8'),
  ) as {
    exp: number;
    sub: number;
    sid?: number;
  };
  const nowSec = Math.floor(Date.now() / 1000);
  const remainingSec = payload.exp - nowSec;

  if (remainingSec <= 12) {
    await page.waitForTimeout(Math.max((remainingSec + 1) * 1000, 1000));
  } else {
    const expiredPayload = {
      ...payload,
      exp: nowSec - 10,
    };
    const forgedExpiredToken = [
      sessionParts[0],
      Buffer.from(JSON.stringify(expiredPayload)).toString('base64url'),
      sessionParts[2],
    ].join('.');

    await context.addCookies([
      {
        name: 'hsk_admin_session',
        value: forgedExpiredToken,
        url: 'http://127.0.0.1:3200',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
  }

  await page.goto('/admin/media');
  await expect(page).toHaveURL(/\/admin\/media/);
  await expect(
    page.getByRole('heading', { name: 'Thư viện media' }),
  ).toBeVisible();

  const refreshedCookies = await context.cookies();
  const refreshedSession = refreshedCookies.find(
    (c) => c.name === 'hsk_admin_session',
  )?.value;
  const refreshedRefresh = refreshedCookies.find(
    (c) => c.name === 'hsk_admin_session_refresh',
  )?.value;

  expect(refreshedSession).toBeTruthy();
  expect(refreshedRefresh).toBeTruthy();
  expect(refreshedSession).not.toBe(initialSession);
  expect(refreshedRefresh).not.toBe(initialRefresh);

  const refreshedPayloadStr = refreshedSession?.split('.')[1] ?? '';
  const refreshedPayload = JSON.parse(
    Buffer.from(refreshedPayloadStr, 'base64url').toString('utf8'),
  ) as { sid?: unknown };
  const refreshedSid = refreshedPayload.sid;
  expect(
    Number.isInteger(refreshedSid),
    'refreshed admin access token must carry an integer sid claim',
  ).toBe(true);

  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(page).toHaveURL(/\/login/);

  await expect
    .poll(async () => {
      const currentCookies = await context.cookies();
      return currentCookies.some(
        (c) =>
          (c.name === 'hsk_admin_session' ||
            c.name === 'hsk_admin_session_refresh') &&
          c.value !== '',
      );
    })
    .toBe(false);

  const meRes = await page.request.get('/api/session/me');
  expect([401, 403]).toContain(meRes.status());

  const reason = queryDisposableDb(
    `SELECT "revocationReason" FROM "UserSession" WHERE id = ${Number(refreshedSid)}`,
  );
  expect(reason).toBe('logout');
});
