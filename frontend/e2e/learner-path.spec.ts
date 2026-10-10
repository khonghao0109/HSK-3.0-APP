import { expect, test, type Locator, type Page } from '@playwright/test';

const PASSWORD = 'StrongPassword123!';
const TOAST_COMING_SOON = 'Tính năng sắp ra mắt.';
const JADE_700 = 'rgb(2, 142, 106)';

function uniqueEmail(tag: string): string {
  return `learner.path.${tag}.${Date.now()}.${Math.floor(Math.random() * 10000)}@example.test`;
}

function appOrigin(baseURL: string | undefined): string {
  return new URL(baseURL ?? 'http://127.0.0.1:3200').origin;
}

/**
 * Registers through the BFF and completes onboarding for `targetBand`
 * (default 1) so the learner reaches nextStep 'ready'.
 */
async function registerReadyLearner(
  page: Page,
  baseURL: string | undefined,
  targetBand = 1,
): Promise<void> {
  const origin = appOrigin(baseURL);
  const register = await page.request.post('/api/learner/session/register', {
    headers: { origin, 'content-type': 'application/json' },
    data: { email: uniqueEmail(`band${targetBand}`), password: PASSWORD },
  });
  expect(register.status()).toBe(201);

  await page.goto('/sign-in');
  const completeStatus = await page.evaluate(async (band) => {
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
        targetBand: band,
        dailyMinutes: 15,
        reminderEnabled: true,
        reminderTime: '07:00',
        startDate,
      }),
    });
    return res.status;
  }, targetBand);
  expect(completeStatus).toBe(200);
}

function tabBar(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Điều hướng chính' });
}

function levelTab(page: Page, name: string): Locator {
  return page
    .getByRole('tablist', { name: 'Cấp độ HSK' })
    .getByRole('tab', { name, exact: true });
}

function toasts(page: Page): Locator {
  return page.locator('.toast-region[role="status"] .toast');
}

async function readCspViolations(page: Page): Promise<string[] | null> {
  return page.evaluate(() => {
    const value: unknown = Reflect.get(window, '__cspViolations');
    return Array.isArray(value) ? value.map(String) : null;
  });
}

test.describe('Learner path (M2.4b)', () => {
  test('tab Học opens /learn/path on the goal level', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/learn');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const learnLink = tabBar(page).getByRole('link', {
      name: 'Học',
      exact: true,
    });
    await learnLink.click();
    await expect(page).toHaveURL(/\/learn\/path$/);
    await expect(learnLink).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveTitle('Lộ trình học · Hán Lộ');
    await expect(levelTab(page, 'HSK 1')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const current = page.locator('.topic.is-current');
    await expect(current).toHaveCount(1);
    await expect(current.locator('.topic__name')).toHaveText(
      'Greetings & first meetings',
    );
  });

  test('current tile and next-lesson button show the coming-soon toast', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/learn/path');
    const all = toasts(page);

    await expect(all).toHaveCount(0);
    await page.locator('.topic.is-current').click();
    await expect(all).toHaveCount(1);
    await expect(all).toHaveText(TOAST_COMING_SOON);

    await expect(all).toHaveCount(0);
    await page.locator('.path-next__btn').click();
    await expect(all).toHaveCount(1);
    await expect(all).toHaveText(TOAST_COMING_SOON);
  });

  test('levels without lessons say they are not open yet', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/learn/path');
    await expect(page.locator('ol.path-grid')).toHaveCount(1);

    for (const name of ['HSK 2', 'HSK 4']) {
      await test.step(name, async () => {
        await levelTab(page, name).click();
        await expect(levelTab(page, name)).toHaveAttribute(
          'aria-selected',
          'true',
        );
        await expect(page.locator('.path-sub')).toHaveText(`${name} chưa mở.`);
        await expect(page.locator('ol.path-grid')).toHaveCount(0);
      });
    }
  });

  test('arrow, Home and End keys move between level tabs', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/learn/path');

    const hsk1 = levelTab(page, 'HSK 1');
    await expect(hsk1).toHaveAttribute('aria-selected', 'true');
    await hsk1.focus();

    const steps: Array<[string, string]> = [
      ['ArrowRight', 'HSK 2'],
      ['ArrowLeft', 'HSK 1'],
      ['End', 'HSK 7–9'],
      ['Home', 'HSK 1'],
    ];
    for (const [key, name] of steps) {
      await test.step(`${key} → ${name}`, async () => {
        await page.keyboard.press(key);
        const tab = levelTab(page, name);
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await expect(tab).toBeFocused();
        await expect(
          page.locator('.path-tab[aria-selected="true"]'),
        ).toHaveCount(1);
      });
    }
  });

  test('HSK 7–9 learner at 195x422 sees the selected tab without overflow', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL, 7);
    await page.setViewportSize({ width: 195, height: 422 });
    await page.goto('/learn/path');

    const tab = levelTab(page, 'HSK 7–9');
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    const box = await tab.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(195);
    }
    const layout = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollY: window.scrollY,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.scrollY).toBe(0);
  });

  test('keyboard focus shows the jade-700 ring on path controls', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/learn/path');
    await expect(page.locator('.topic')).not.toHaveCount(0);

    const targets: Array<{ label: string; control: Locator }> = [
      { label: 'logo', control: page.locator('.path-head__logo') },
      {
        label: 'selected tab',
        control: page.locator('.path-tab[aria-selected="true"]'),
      },
      { label: 'first topic', control: page.locator('.topic').first() },
      { label: 'next button', control: page.locator('.path-next__btn') },
    ];
    for (const { label, control } of targets) {
      await test.step(label, async () => {
        let reached = false;
        for (let i = 0; i < 30 && !reached; i += 1) {
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
        expect(boxShadow, `${label} focus ring`).toContain(JADE_700);
      });
    }
  });

  test('hard load and client navigation raise no CSP violation', async ({
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

    await page.goto('/learn/path');
    await expect(page.locator('.topic.is-current')).toHaveCount(1);
    expect(await readCspViolations(page)).toEqual([]);
    expect(cspConsole).toEqual([]);

    await tabBar(page).getByRole('link', { name: 'Trang chủ' }).click();
    await expect(page).toHaveURL(/\/learn$/);
    await expect(page.locator('.home-explore')).toBeVisible();
    expect(await readCspViolations(page)).toEqual([]);
    expect(cspConsole).toEqual([]);

    await tabBar(page).getByRole('link', { name: 'Học', exact: true }).click();
    await expect(page).toHaveURL(/\/learn\/path$/);
    await expect(page.locator('.topic.is-current')).toHaveCount(1);
    expect(await readCspViolations(page)).toEqual([]);
    expect(cspConsole).toEqual([]);
  });

  test('selected tab indicator keeps its color in forced colors', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto('/learn/path');
    const selected = page.locator('.path-tab[aria-selected="true"]');
    await expect(selected).toHaveCount(1);
    const adjust = await selected.evaluate(
      (node) => window.getComputedStyle(node, '::after').forcedColorAdjust,
    );
    expect(adjust).toBe('none');
  });

  test('fits ≤ 299px with two columns, no lesson art and a one-line next bar', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.setViewportSize({ width: 195, height: 422 });
    await page.goto('/learn/path');
    await expect(page.locator('.topic.is-current')).toHaveCount(1);

    const columns = await page
      .locator('.path-grid')
      .evaluate((node) =>
        window.getComputedStyle(node).gridTemplateColumns.split(' '),
      );
    expect(columns).toHaveLength(2);
    await expect(page.locator('.topic__art').first()).toBeHidden();

    const fits = await page.evaluate(() => {
      const bar = document.querySelector('.path-next');
      if (!bar) return null;
      const outer = bar.getBoundingClientRect();
      return ['.path-next__label', '.path-next__title'].map((selector) => {
        const box = bar.querySelector(selector)?.getBoundingClientRect();
        return box
          ? box.top >= outer.top &&
              box.bottom <= outer.bottom &&
              box.left >= outer.left &&
              box.right <= outer.right
          : false;
      });
    });
    expect(fits).toEqual([true, true]);
  });

  test('level tabs are hittable across their full 44px height', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/learn/path');
    const tab = page.getByRole('tab', { name: 'HSK 2' });
    const box = await tab.boundingBox();
    if (!box) throw new Error('HSK 2 tab has no box');
    expect(box.height).toBeGreaterThanOrEqual(44);
    const hits = await tab.evaluate(
      (node, ys) =>
        ys.map(
          (y) =>
            document
              .elementFromPoint(
                node.getBoundingClientRect().left +
                  node.getBoundingClientRect().width / 2,
                y,
              )
              ?.closest('[role="tab"]') === node,
        ),
      [box.y + 1, box.y + box.height - 1],
    );
    expect(hits).toEqual([true, true]);
  });

  test('keeps the focused level tab outline inside the tab in forced colors', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto('/learn/path');
    const selected = page.locator('.path-tab[aria-selected="true"]');
    await expect(selected).toHaveCount(1);
    let reached = false;
    for (let i = 0; i < 20 && !reached; i += 1) {
      await page.keyboard.press('Tab');
      reached = await selected.evaluate(
        (node) => node === document.activeElement,
      );
    }
    expect(reached).toBe(true);
    await expect(selected).toHaveCSS('outline-offset', '-3px');
  });
});
