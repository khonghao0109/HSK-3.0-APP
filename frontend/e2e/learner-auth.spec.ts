import { expect, test, type Page } from '@playwright/test';

test.use({
  viewport: { width: 390, height: 844 },
});

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? 'admin.frontend@example.test';
const adminPassword =
  process.env.E2E_ADMIN_PASSWORD ?? 'FrontendTest-Admin-123';

async function completeOnboarding(page: Page): Promise<void> {
  const completeStatus = await page.evaluate(async () => {
    // startDate must be the learner's current local calendar date.
    const now = new Date();
    const startDate = [
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    const res = await fetch('/api/learner/onboarding/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        learningPurpose: 'communication',
        targetBand: 1,
        dailyMinutes: 15,
        reminderEnabled: true,
        reminderTime: '19:00',
        startDate,
      }),
    });
    return res.status;
  });
  expect(completeStatus).toBe(200);
}

const VIEWPORTS_8 = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 844, height: 390 },
  { width: 195, height: 422 },
];

test.describe('Learner Auth Flow', () => {
  test('redirects unauthenticated user from /learn to /sign-in', async ({
    page,
  }) => {
    await page.goto('/learn');
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page).toHaveTitle('Đăng nhập · Hán Lộ');
  });

  test('registers a new learner and displays email then logs out', async ({
    page,
  }) => {
    const randomEmail = `learner.${Date.now()}.${Math.floor(Math.random() * 10000)}@example.test`;
    const password = 'StrongPassword123!';

    await page.goto('/');
    await expect(page).toHaveTitle('Hán Lộ — Con đường chinh phục tiếng Trung');

    const startBtn = page.getByRole('link', { name: 'Bắt đầu học' });
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    await expect(page).toHaveURL(/\/sign-up/);
    await expect(page).toHaveTitle('Tạo tài khoản · Hán Lộ');

    await page.getByLabel('Email').fill(randomEmail);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();

    await expect(page).toHaveURL(/\/onboarding\/goal/);
    await completeOnboarding(page);
    await page.goto('/learn');
    await expect(page).toHaveURL(/\/learn/);
    await expect(page).toHaveTitle('Góc học tập · Hán Lộ');
    await expect(page.locator('h1')).toContainText(randomEmail);

    const logoutBtn = page.getByRole('button', { name: 'Đăng xuất' });
    await expect(logoutBtn).toBeVisible();
    await logoutBtn.click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page).toHaveTitle('Hán Lộ — Con đường chinh phục tiếng Trung');
  });

  test('shows 401 error message when signing in with incorrect password', async ({
    page,
  }) => {
    const randomEmail = `learner.wrong.${Date.now()}.${Math.floor(Math.random() * 10000)}@example.test`;
    const password = 'StrongPassword123!';

    // Register first
    await page.goto('/sign-up');
    await page.getByLabel('Email').fill(randomEmail);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();
    await expect(page).toHaveURL(/\/onboarding\/goal/);
    await completeOnboarding(page);
    await page.goto('/learn');
    await expect(page).toHaveURL(/\/learn/);

    // Logout
    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await expect(page).toHaveURL(/\/$/);

    // Attempt sign in with wrong password
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(randomEmail);
    await page
      .getByLabel('Mật khẩu', { exact: true })
      .fill('WrongPassword123!');
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    const alert = page.locator('.alert--error');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Email hoặc mật khẩu không đúng.');
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('signs in successfully with correct credentials and navigates to /learn', async ({
    page,
  }) => {
    const randomEmail = `learner.valid.${Date.now()}.${Math.floor(Math.random() * 10000)}@example.test`;
    const password = 'StrongPassword123!';

    // Register first
    await page.goto('/sign-up');
    await page.getByLabel('Email').fill(randomEmail);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();
    await expect(page).toHaveURL(/\/onboarding\/goal/);
    await completeOnboarding(page);
    await page.goto('/learn');
    await expect(page).toHaveURL(/\/learn/);

    // Logout
    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await expect(page).toHaveURL(/\/$/);

    // Sign in
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(randomEmail);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    await expect(page).toHaveURL(/\/learn/);
    await expect(page.locator('h1')).toContainText(randomEmail);
  });

  test('shows admin_account error and stays on /sign-in when using E2E_ADMIN_EMAIL', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(adminEmail);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(adminPassword);
    await page.getByRole('button', { name: 'Đăng nhập' }).click();

    const alert = page.locator('.alert--error');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(
      'Tài khoản này không dùng để học. Hãy đăng nhập bằng tài khoản học viên.',
    );
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('completes sign-in flow using only keyboard navigation', async ({
    page,
  }) => {
    const randomEmail = `learner.kbd.${Date.now()}.${Math.floor(Math.random() * 10000)}@example.test`;
    const password = 'StrongPassword123!';

    // Register account first
    await page.goto('/sign-up');
    await page.getByLabel('Email').fill(randomEmail);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();
    await expect(page).toHaveURL(/\/onboarding\/goal/);
    await completeOnboarding(page);
    await page.goto('/learn');
    await expect(page).toHaveURL(/\/learn/);

    // Logout
    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await expect(page).toHaveURL(/\/$/);

    // Go to sign-in and use keyboard navigation
    await page.goto('/sign-in');

    // Tab into back link, then email
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Email')).toBeFocused();
    // Q12: solid jade-700 focus ring (no alpha) on the email input
    await expect(page.getByLabel('Email')).toHaveCSS(
      'box-shadow',
      /rgb\(2, 142, 106\)/,
    );
    await page.keyboard.type(randomEmail);

    // Tab into password
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Mật khẩu', { exact: true })).toBeFocused();
    await page.keyboard.type(password);

    // Tab past toggle to submit button
    await page.keyboard.press('Tab'); // focus toggle
    await page.keyboard.press('Tab'); // focus submit
    await expect(page.getByRole('button', { name: 'Đăng nhập' })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/learn/);
    await expect(page.locator('h1')).toContainText(randomEmail);
  });

  test('verifies responsive layout and touch target sizing across 8 viewports', async ({
    page,
  }) => {
    // Register a user first to test /learn
    const randomEmail = `learner.responsive.${Date.now()}.${Math.floor(Math.random() * 10000)}@example.test`;
    const password = 'StrongPassword123!';
    await page.goto('/sign-up');
    await page.getByLabel('Email').fill(randomEmail);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();
    await expect(page).toHaveURL(/\/onboarding\/goal/);
    await completeOnboarding(page);
    await page.goto('/learn');
    await expect(page).toHaveURL(/\/learn/);

    // Test /learn at all 8 viewports
    for (const vp of VIEWPORTS_8) {
      await page.setViewportSize(vp);
      const noOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
      expect(
        noOverflow,
        `horizontal overflow on /learn at ${vp.width}x${vp.height}`,
      ).toBe(true);

      if (vp.width >= 320) {
        const interactiveElements = await page
          .locator('a, button, input')
          .all();
        for (const el of interactiveElements) {
          if (await el.isVisible()) {
            const box = await el.boundingBox();
            if (box) {
              expect(
                box.height,
                `Element height on /learn at ${vp.width}x${vp.height}`,
              ).toBeGreaterThanOrEqual(43.9);
            }
          }
        }
      }
    }

    // Logout to test public routes
    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await expect(page).toHaveURL(/\/$/);

    const publicRoutes = ['/', '/sign-up', '/sign-in', '/terms', '/privacy'];
    for (const route of publicRoutes) {
      for (const vp of VIEWPORTS_8) {
        await page.setViewportSize(vp);
        await page.goto(route);
        const noOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        );
        expect(
          noOverflow,
          `horizontal overflow on ${route} at ${vp.width}x${vp.height}`,
        ).toBe(true);

        if (vp.width >= 320) {
          const interactiveElements = await page
            .locator('a, button, input')
            .all();
          for (const el of interactiveElements) {
            if (await el.isVisible()) {
              const box = await el.boundingBox();
              if (box) {
                expect(
                  box.height,
                  `Element height on ${route} at ${vp.width}x${vp.height}`,
                ).toBeGreaterThanOrEqual(43.9);
              }
            }
          }
        }
      }
    }
  });

  test('verifies accessibility requirements across all pages', async ({
    page,
  }) => {
    // 1. Heading on /
    await page.goto('/');
    await expect(page.locator('h1')).toMatchAriaSnapshot(
      '- heading "Hán Lộ" [level=1]',
    );

    // 2. .learner-app[lang="vi"] exists on all 6 pages
    const randomEmail = `learner.a11y.${Date.now()}.${Math.floor(Math.random() * 10000)}@example.test`;
    const password = 'StrongPassword123!';
    await page.goto('/sign-up');
    await page.getByLabel('Email').fill(randomEmail);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();
    await expect(page).toHaveURL(/\/onboarding\/goal/);
    await completeOnboarding(page);
    await page.goto('/learn');
    await expect(page).toHaveURL(/\/learn/);

    // Check on /learn
    await expect(page.locator('.learner-app[lang="vi"]')).toBeVisible();

    // Check on 5 public pages
    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await expect(page).toHaveURL(/\/$/);

    const publicRoutes = ['/', '/sign-up', '/sign-in', '/terms', '/privacy'];
    for (const route of publicRoutes) {
      await page.goto(route);
      await expect(page.locator('.learner-app[lang="vi"]')).toBeVisible();
    }

    // 3. /terms and /privacy links open and have correct h1
    await page.goto('/sign-up');
    const termsLink = page.getByRole('link', { name: 'Điều khoản sử dụng' });
    await expect(termsLink).toBeVisible();
    await termsLink.click();
    await expect(page).toHaveURL(/\/terms/);
    await expect(page.locator('h1')).toHaveText('Điều khoản sử dụng');

    await page.goto('/sign-up');
    const privacyLink = page.getByRole('link', { name: 'Chính sách bảo mật' });
    await expect(privacyLink).toBeVisible();
    await privacyLink.click();
    await expect(page).toHaveURL(/\/privacy/);
    await expect(page.locator('h1')).toHaveText('Chính sách bảo mật');
  });

  test('preserves Next.js route announcer on client navigation', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('next-route-announcer')).toHaveCount(1);
    await page.getByRole('link', { name: 'Bắt đầu học' }).click();
    await expect(page).toHaveURL(/\/sign-up/);
    await expect(page.locator('#__next-route-announcer__')).toHaveText(
      /Tạo tài khoản|Chào mừng đến với/,
    );
  });
});
