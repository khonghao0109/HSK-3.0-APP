import { expect, test, type Locator, type Page } from '@playwright/test';

const PASSWORD = 'StrongPassword123!';
const TOAST_COMING_SOON = 'Tính năng sắp ra mắt.';
const TOAST_NOTIFICATIONS = 'Thông báo sẽ có khi tính năng ra mắt.';
// Q12: solid jade-700 focus ring (no alpha).
const JADE_700_RING = 'rgb(2, 142, 106) 0px 0px 0px 3px';

function uniqueEmail(tag: string): string {
  return `learner.home.${tag}.${Date.now()}.${Math.floor(Math.random() * 10000)}@example.test`;
}

function appOrigin(baseURL: string | undefined): string {
  return new URL(baseURL ?? 'http://127.0.0.1:3200').origin;
}

/**
 * Registers through the BFF (cookies land in the page context), completes
 * onboarding for HSK1 so /learn renders Home (nextStep 'ready').
 */
async function registerReadyLearner(
  page: Page,
  baseURL: string | undefined,
  name?: string,
): Promise<void> {
  const origin = appOrigin(baseURL);
  const body: Record<string, string> = {
    email: uniqueEmail(name ? 'named' : 'anon'),
    password: PASSWORD,
  };
  if (name) body.name = name;

  const register = await page.request.post('/api/learner/session/register', {
    headers: { origin, 'content-type': 'application/json' },
    data: body,
  });
  expect(register.status()).toBe(201);

  // Need a document on the app origin before calling fetch from the page.
  await page.goto('/sign-in');
  const completeStatus = await page.evaluate(async () => {
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
        learningPurpose: 'hsk_exam',
        targetBand: 1,
        dailyMinutes: 15,
        reminderEnabled: true,
        reminderTime: '07:00',
        startDate,
      }),
    });
    return res.status;
  });
  expect(completeStatus).toBe(200);
}

function tabBar(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Điều hướng chính' });
}

function toast(page: Page): Locator {
  return page.locator('.toast-region[role="status"]');
}

test.describe('Learner Home (M2.4a)', () => {
  test('greets a learner registered with a name', async ({ page, baseURL }) => {
    await registerReadyLearner(page, baseURL, 'Lan');
    await page.goto('/learn');
    await expect(page).toHaveURL(/\/learn$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Chào, Lan',
    );
  });

  test('greets a learner registered without a name with "Chào bạn"', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/learn');
    await expect(page).toHaveURL(/\/learn$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Chào bạn',
    );
  });

  test('each not-yet-shipped control shows its exact toast text', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/learn');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const nav = tabBar(page);
    const controls: Array<{ label: string; control: Locator; text: string }> = [
      {
        label: 'bell',
        control: page.getByRole('button', { name: 'Thông báo' }),
        text: TOAST_NOTIFICATIONS,
      },
      {
        label: 'Thi thử',
        control: page
          .locator('.home-explore')
          .getByRole('button', { name: 'Thi thử' }),
        text: TOAST_COMING_SOON,
      },
      {
        label: 'tab Học',
        control: nav.getByRole('button', { name: 'Học', exact: true }),
        text: TOAST_COMING_SOON,
      },
      {
        label: 'tab Tra từ',
        control: nav.getByRole('button', { name: 'Tra từ' }),
        text: TOAST_COMING_SOON,
      },
      {
        label: 'tab Ôn tập',
        control: nav.getByRole('button', { name: 'Ôn tập' }),
        text: TOAST_COMING_SOON,
      },
      {
        label: 'Tiếp tục học card',
        control: page.locator('.home-lesson'),
        text: TOAST_COMING_SOON,
      },
    ];

    // Wait for earlier toasts to expire (2.4 s) so each click must add
    // exactly one toast carrying its own text.
    const toasts = toast(page).locator('.toast');
    for (const { label, control, text } of controls) {
      await test.step(label, async () => {
        await expect(control).toHaveCount(1);
        await expect(toasts).toHaveCount(0);
        await control.click();
        await expect(toasts).toHaveCount(1);
        await expect(toasts).toHaveText(text);
        await expect(toasts).toBeVisible();
      });
    }
  });

  test('marks the active tab with aria-current="page"', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    const nav = tabBar(page);
    const home = nav.getByRole('link', { name: 'Trang chủ' });
    const profile = nav.getByRole('link', { name: 'Hồ sơ' });

    await page.goto('/learn');
    await expect(home).toHaveAttribute('aria-current', 'page');
    await expect(profile).not.toHaveAttribute('aria-current', /.*/);

    await page.goto('/learn/profile');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hồ sơ');
    await expect(profile).toHaveAttribute('aria-current', 'page');
    await expect(home).not.toHaveAttribute('aria-current', /.*/);
  });

  test('logs out from /learn/profile and lands on /', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/learn/profile');
    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await expect(page).toHaveURL(new URL('/', appOrigin(baseURL)).href);

    await page.goto('/learn');
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('client navigation Hồ sơ → Trang chủ raises no CSP violation', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);

    const cspConsole: string[] = [];
    page.on('console', (message) => {
      const text = message.text();
      if (text.includes('Content Security Policy')) cspConsole.push(text);
    });
    await page.addInitScript(() => {
      const store: string[] = [];
      Object.defineProperty(window, '__cspViolations', { value: store });
      document.addEventListener('securitypolicyviolation', (event) => {
        store.push(`${event.violatedDirective} ${event.blockedURI}`);
      });
    });

    await page.goto('/learn/profile');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hồ sơ');

    await tabBar(page).getByRole('link', { name: 'Trang chủ' }).click();
    await expect(page).toHaveURL(/\/learn$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.home-explore')).toBeVisible();

    const violations = await page.evaluate(() => {
      const value: unknown = Reflect.get(window, '__cspViolations');
      return Array.isArray(value) ? value.map(String) : null;
    });
    expect(violations).toEqual([]);
    expect(cspConsole).toEqual([]);

    // Hard load as well: the server render must not need inline styles either.
    await page.goto('/learn');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.home-gauge')).toBeVisible();
    const hardLoadViolations = await page.evaluate(() => {
      const value: unknown = Reflect.get(window, '__cspViolations');
      return Array.isArray(value) ? value.map(String) : null;
    });
    expect(hardLoadViolations).toEqual([]);
    expect(cspConsole).toEqual([]);
  });

  test('keyboard focus shows the jade-700 ring on every tab bar item', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/learn');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const nav = tabBar(page);
    const items = nav.locator(':scope > a, :scope > button');
    await expect(items).toHaveCount(5);
    const firstItem = items.first();

    // Tab through the page until the first tab bar item gets focus.
    let reached = false;
    for (let i = 0; i < 60 && !reached; i += 1) {
      await page.keyboard.press('Tab');
      reached = await firstItem.evaluate(
        (node) => node === document.activeElement,
      );
    }
    expect(reached).toBe(true);

    const expectedLabels = ['Trang chủ', 'Học', 'Tra từ', 'Ôn tập', 'Hồ sơ'];
    for (const [index, label] of expectedLabels.entries()) {
      const item = items.nth(index);
      await expect(item).toBeFocused();
      await expect(item).toHaveText(label);
      expect(
        await item.evaluate((node) => node.matches(':focus-visible')),
      ).toBe(true);
      const boxShadow = await item.evaluate(
        (node) => window.getComputedStyle(node).boxShadow,
      );
      expect(boxShadow).toContain(JADE_700_RING);
      if (index < expectedLabels.length - 1) {
        await page.keyboard.press('Tab');
      }
    }
  });

  test('keyboard focus shows the jade-700 ring on Home controls', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/learn');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const targets: Array<{ label: string; control: Locator }> = [
      { label: 'logo', control: page.locator('.home-hero__logo') },
      { label: 'bell', control: page.locator('.home-hero__bell') },
      { label: 'avatar', control: page.locator('.home-hero__avatar') },
    ];
    if ((await page.locator('.home-lesson').count()) > 0) {
      targets.push({ label: 'lesson', control: page.locator('.home-lesson') });
    }
    targets.push({
      label: 'first explore',
      control: page.locator('.home-explore > li:first-child > button'),
    });

    for (const { label, control } of targets) {
      await test.step(label, async () => {
        let reached = false;
        for (let i = 0; i < 20 && !reached; i += 1) {
          await page.keyboard.press('Tab');
          reached = await control.evaluate(
            (node) => node === document.activeElement,
          );
        }
        expect(reached, `${label} reachable by Tab`).toBe(true);
        expect(
          await control.evaluate((node) => node.matches(':focus-visible')),
        ).toBe(true);
        const boxShadow = await control.evaluate(
          (node) => window.getComputedStyle(node).boxShadow,
        );
        expect(boxShadow, `${label} focus ring`).toContain('rgb(2, 142, 106)');
      });
    }
  });

  test('keeps the gauge readable and hides the art in forced colors', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto('/learn');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.home-hero__art')).toBeHidden();
    const gaugeImage = await page
      .locator('.home-gauge')
      .evaluate((node) => window.getComputedStyle(node).backgroundImage);
    expect(gaugeImage).toContain('conic-gradient');
  });
});
