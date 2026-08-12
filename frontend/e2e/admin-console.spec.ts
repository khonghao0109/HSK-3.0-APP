import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

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
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Return to platform' }),
  ).toBeVisible();
}

async function assertLoginLayout(page: Page) {
  const metrics = await assertNoHorizontalOverflow(page);
  await expect(page.locator('.login-panel')).toBeInViewport();
  await expect(page.locator('.login-card')).toBeInViewport();
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
  await expect(page.getByText('Your session ended.')).toBeVisible();
  await assertLoginLayout(page);
  releaseRecovery.resolve();
  await recoveryCompleted.promise;
  await page.unroute('**/api/session/recover');

  await page.route('**/api/session/recover', async (route) => {
    await route.fulfill({ status: 503 });
  });
  await page.goto('/login?reason=session');
  await expect(
    page.getByRole('button', { name: 'Retry session check' }),
  ).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await assertLoginActionsVisible(page);
});

async function login(page: Page, email = adminEmail, password = adminPassword) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
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
  await expect(
    page.getByRole('heading', { name: /welcome back/i }),
  ).toBeVisible();
  await page.goto('/admin/exercises');
  await expect(page).toHaveURL('http://127.0.0.1:3200/login?reason=session');
  expect(consoleErrors).toEqual([]);
});

test('keeps Return to platform client navigation RSC-safe and canonical', async ({
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
    page.getByRole('link', { name: 'Return to platform' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Return to platform' }).click();
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
  await page.getByLabel('Password').fill(adminPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByRole('button', { name: 'Checking session…' }),
  ).toBeDisabled();
  await expect(page.getByLabel('Email')).toHaveValue(adminEmail);
  await expect(page.getByLabel('Password')).toHaveValue(adminPassword);
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
  await page.getByLabel('Password').fill(adminPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
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
  await expect(page.getByRole('heading', { name: 'Exercises' })).toBeVisible();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(consoleErrors).toEqual([]);
});

test('routes a current non-admin to forbidden without rendering admin data', async ({
  page,
}) => {
  await login(page, userEmail, userPassword);
  await expect(page).toHaveURL(/\/forbidden/);
  await expect(
    page.getByRole('heading', { name: /access restricted/i }),
  ).toBeVisible();
  await expect(page.getByText('Authoritative answer')).toHaveCount(0);
});

test('uses URL filters and server pagination, then opens a detail', async ({
  page,
}) => {
  await login(page);
  await page.goto('/admin/exercises?limit=1&page=1');
  await expect(page.getByText(/page 1 of 3/i)).toBeVisible();
  await page.getByRole('link', { name: /next/i }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText(/page 2 of 3/i)).toBeVisible();
  await page.getByLabel('Status').selectOption('published');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(/status=published/);
  await page
    .getByRole('link', { name: /open exercise/i })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: /exercise \d+/i }),
  ).toBeVisible();
  await expect(page.getByText('Authoritative answer')).toBeVisible();
  await expect(page.getByText('Revision history')).toBeVisible();
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
    await expect(
      page.getByRole('heading', { name: 'Exercise 1', exact: true }),
    ).toBeVisible();

    const metrics = await assertNoHorizontalOverflow(page);
    expect(metrics.innerWidth).toBe(width);

    const revisionPanel = page.locator('.revision-panel');
    const hash = revisionPanel.locator('.hash');
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

test('matches the admin operations shell and adaptive inventory contract', async ({
  page,
}, testInfo: TestInfo) => {
  await login(page);
  await expect(page).toHaveURL(/\/admin\/exercises/u);
  await assertNoHorizontalOverflow(page);

  const sidebar = page.locator('.sidebar');
  const desktopTable = page.locator('.exercise-table');
  const compactList = page.getByRole('list', {
    name: 'Exercises for narrow screens',
  });

  if (testInfo.project.name.startsWith('desktop-')) {
    await expect(sidebar).toBeVisible();
    const sidebarBox = await sidebar.boundingBox();
    expect(sidebarBox?.width).toBeGreaterThanOrEqual(208);
    expect(sidebarBox?.width).toBeLessThanOrEqual(232);
    await expect(
      page.getByRole('banner', { name: 'Admin workspace toolbar' }),
    ).toBeVisible();
    await expect(desktopTable).toBeVisible();
    await expect(compactList).toBeHidden();
  } else {
    await expect(sidebar).toBeHidden();
    await expect(page.locator('.mobile-header')).toBeVisible();
    await expect(desktopTable).toBeHidden();
    await expect(compactList).toBeVisible();

    const logoutBox = await page
      .getByRole('button', { name: 'Log out' })
      .boundingBox();
    expect(logoutBox?.width).toBeGreaterThanOrEqual(44);
    expect(logoutBox?.height).toBeGreaterThanOrEqual(44);
  }

  await expect(
    page.getByRole('button', { name: /create|publish|import|media/i }),
  ).toHaveCount(0);
});

test('navigates the secure Media library, filters assets and opens safe detail', async ({
  page,
  request,
}, testInfo: TestInfo) => {
  const consoleIssues = captureConsoleIssues(page);
  await login(page);
  const adminNavigation = page.getByRole('navigation', {
    name: testInfo.project.name.startsWith('desktop-')
      ? 'Admin navigation'
      : 'Admin module navigation',
  });
  await adminNavigation
    .getByRole('link', { name: 'Media', exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/media/u);
  await expect(
    page.getByRole('heading', { name: 'Media library' }),
  ).toBeVisible();
  await assertNoHorizontalOverflow(page);

  await page.getByLabel('Type').selectOption('audio');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(/type=audio/u);

  const desktopTable = page.locator('.media-table');
  const compactList = page.getByRole('list', {
    name: 'Media for narrow screens',
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
  await mediaRecord.getByRole('link', { name: /open media \d+/iu }).click();
  await expect(
    page.getByRole('heading', { name: 'nihao-listening.mp3' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Technical metadata', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'References', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Lifecycle operations', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/cdn\.example|private-test-provider|checksum-/i),
  ).toHaveCount(0);
  await assertNoHorizontalOverflow(page);

  const metadataFacts = page.locator('.fact-list--two-columns > div');
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
    await page.getByRole('button', { name: 'Quarantine asset' }).click();
    await expect(page.getByText('Quarantined')).toBeVisible();
  }

  await expect(page).toHaveTitle(/Media detail · HSK Content Workbench/u);
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
  await page.getByLabel('Password').fill(adminPassword);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/exercises/);
  await expect(page).toHaveTitle(/Exercises · HSK Content Workbench/u);
  await expect(page.getByRole('heading', { name: 'Exercises' })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
