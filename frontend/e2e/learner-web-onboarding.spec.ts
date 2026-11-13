import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

import { PASSWORD, registerReadyLearner } from './support/learner-fixtures';

// M2.10c: the onboarding screens sit in the `.w-public` web frame from 1024px
// (PO Q81, sample `docs/ui_reference/web/onboarding-{goal,plan}.html`). The
// `@web` tag keeps these runs on desktop-1024/desktop-1440; the last test
// resizes to 390px on purpose to prove the mobile chrome is still the one the
// page shows below the breakpoint (K3a).

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const GOAL_TITLE = 'Mục tiêu học tập của bạn là gì?';

/** Registers a learner who has not chosen a goal yet (cookies on the page). */
async function registerLearnerWithoutGoal(
  page: Page,
  baseURL: string | undefined,
): Promise<void> {
  const origin = new URL(baseURL ?? 'http://127.0.0.1:3200').origin;
  const response = await page.request.post('/api/learner/session/register', {
    headers: { origin, 'content-type': 'application/json' },
    data: {
      email: `learner.webob.${Date.now()}.${Math.floor(Math.random() * 10000)}@example.test`,
      password: PASSWORD,
    },
  });
  expect(response.status()).toBe(201);
}

/** Q69/Q42: every visible match of `selector` is at least 44x44. */
async function expectTouchTargets(
  page: Page,
  selector: string,
  label: string,
): Promise<void> {
  const targets = page.locator(selector);
  const count = await targets.count();
  expect(count, `${label}: ${selector} rendered`).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const target = targets.nth(index);
    if (!(await target.isVisible())) continue;
    const box = await target.boundingBox();
    expect(box, `${label}: ${selector} #${index} has a box`).not.toBeNull();
    if (!box) continue;
    expect
      .soft(box.width, `${label}: ${selector} #${index} width`)
      .toBeGreaterThanOrEqual(44);
    expect
      .soft(box.height, `${label}: ${selector} #${index} height`)
      .toBeGreaterThanOrEqual(44);
  }
}

async function expectNoHorizontalOverflow(
  page: Page,
  label: string,
): Promise<void> {
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect
    .soft(layout.scrollWidth, `${label} scroll vs client`)
    .toBeLessThanOrEqual(layout.clientWidth);
}

/** `boundingBox().y` của một phần tử, lỗi rõ ràng nếu phần tử không có hộp. */
async function boxY(locator: Locator, label: string): Promise<number> {
  const box = await locator.boundingBox();
  expect(box, `${label}: có hộp`).not.toBeNull();
  return box?.y ?? Number.NaN;
}

/** `innerText` thô (không chuẩn hoá khoảng trắng như `toHaveText`). */
async function rawInnerText(locator: Locator): Promise<string> {
  return locator.evaluate((element) => (element as HTMLElement).innerText);
}

async function expectAxeClean(page: Page, state: string): Promise<void> {
  await page.waitForLoadState('networkidle');
  // Axe reads colours mid fade-in (switch track, card transitions); wait for
  // the finite animations so a running transition is not read as contrast.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.effect?.getComputedTiming().iterations === Infinity ||
          animation.playState !== 'running',
      ),
  );
  const { violations } = await new AxeBuilder({ page })
    .withTags(AXE_TAGS)
    .analyze();
  expect
    .soft(
      violations.map(
        (violation) =>
          `${violation.id}: ${violation.nodes
            .map((node) => node.target.join(' '))
            .join(' | ')}`,
      ),
      `axe ${state}`,
    )
    .toEqual([]);
}

/** `box-shadow` computed của khung onboarding (`main.app.obw-body`). */
async function shadowOf(page: Page): Promise<string> {
  const frame = page.locator('main.obw-body');
  await expect(frame).toHaveCount(1);
  return frame.evaluate(
    (element) => window.getComputedStyle(element).boxShadow,
  );
}

test.describe('Learner web onboarding (M2.10c) @web', () => {
  test.describe.configure({ timeout: 90_000 });

  test('goal screen: .w-pubnav replaces the mobile chrome, links land on /learn', async ({
    page,
    baseURL,
  }) => {
    await registerLearnerWithoutGoal(page, baseURL);
    await page.goto('/onboarding/goal');
    await expect(
      page.getByRole('heading', { level: 1, name: GOAL_TITLE }),
    ).toBeVisible();

    // Web frame on, mobile chrome off (the onboarding screens render no tab
    // bar at all, so `.ob__top` is the chrome that must disappear).
    await expect(page.locator('.w-pubnav')).toBeVisible();
    await expect(page.locator('.tabbar')).toHaveCount(0);
    await expect(page.locator('.ob__top')).toBeHidden();

    // Q9: a learner without a goal gets the empty 44px box, not a link.
    await expect(page.locator('.w-pubnav .icon-btn')).toHaveCount(1);
    await expect(page.locator('.w-pubnav a.icon-btn')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Hán Lộ' })).toHaveAttribute(
      'href',
      '/learn',
    );

    // Q8: "1/4" with one readable label; the ticks are decorative.
    const steps = page.locator('.obw-steps');
    await expect(steps.locator('ol li')).toHaveCount(4);
    await expect(steps.locator('ol li.is-done')).toHaveCount(1);
    await expect(steps.locator('ol')).toHaveAttribute('aria-hidden', 'true');
    await expect(steps.locator('span')).toHaveCount(1);
    await expect(steps.locator('span')).toHaveText('1/4');
    await expect(steps.locator('span')).toHaveAttribute(
      'aria-label',
      'Bước 1 trên 4',
    );
    // The mobile label is off screen at this width, and the nav does not
    // repeat it as a second readable copy.
    await expect(page.locator('.w-pubnav .sr-only')).toHaveCount(0);

    // Summary panel of the sample, with the single "Tiếp tục" control.
    const summary = page.locator('.obw-summary');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('Lựa chọn của bạn');
    await expect(summary.locator('#sum-goal')).toHaveText('Giao tiếp');
    await expect(summary.locator('#sum-level')).toHaveText('HSK 3');
    await expect(
      summary.getByRole('button', { name: 'Tiếp tục' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tiếp tục' })).toHaveCount(1);

    await expectTouchTargets(
      page,
      '.w-pubnav a, .obw-goal, .obw-levels button, .obw-summary .btn',
      'goal',
    );
    await expectNoHorizontalOverflow(page, 'goal@1024');
    await expectAxeClean(page, 'goal');
  });

  test('goal screen: Tab runs nav first, then the content, then the summary', async ({
    page,
    baseURL,
  }) => {
    await registerLearnerWithoutGoal(page, baseURL);
    await page.goto('/onboarding/goal');
    await expect(page.locator('.w-pubnav')).toBeVisible();

    // 1. Nav (the brand; there is no back link without a goal).
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Hán Lộ' })).toBeFocused();

    // 2. Content: the selected goal, then the selected level (roving tabindex).
    await page.keyboard.press('Tab');
    await expect(page.getByRole('radio', { name: /Giao tiếp/ })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('radio', { name: '3' })).toBeFocused();

    // 3. Summary panel CTA.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Tiếp tục' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(
      /\/onboarding\/plan\?purpose=communication&band=3/,
    );
  });

  test('plan screen: step 2/4, live summary, touch targets and axe', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/onboarding/plan?purpose=hsk_exam&band=1');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Bạn muốn học mỗi ngày',
    );

    await expect(page.locator('.w-pubnav')).toBeVisible();
    await expect(page.locator('.ob__top')).toBeHidden();

    // Q8: "2/4", two done ticks; Q9 back to the goal page with the selection.
    const steps = page.locator('.obw-steps');
    await expect(steps.locator('ol li')).toHaveCount(4);
    await expect(steps.locator('ol li.is-done')).toHaveCount(2);
    await expect(steps.locator('span')).toHaveText('2/4');
    await expect(steps.locator('span')).toHaveAttribute(
      'aria-label',
      'Bước 2 trên 4',
    );
    await expect(page.locator('.w-pubnav .sr-only')).toHaveCount(0);
    await expect(
      page.locator('.w-pubnav').getByRole('link', { name: 'Quay lại' }),
    ).toHaveAttribute('href', '/onboarding/goal?purpose=hsk_exam&band=1');
    await expect(page.getByRole('link', { name: 'Hán Lộ' })).toHaveAttribute(
      'href',
      '/learn',
    );

    // The web summary panel mirrors the goal the fixture saved through the BFF.
    const summary = page.locator('.obw-summary');
    await expect(summary.locator('#sum-goal')).toHaveText('Thi HSK');
    await expect(summary.locator('#sum-level')).toHaveText('HSK 1');
    await expect(summary.locator('#sum-min')).toHaveText('15 phút');
    await expect(summary.locator('#sum-time')).toHaveText('07:00');
    await expect(summary.locator('#sum-remind')).toHaveText('Bật');

    // Live values: minutes card, clock select, reminder switch (Q11).
    await page.getByRole('radio', { name: /30/ }).click();
    await expect(summary.locator('#sum-min')).toHaveText('30 phút');
    await expect(page.locator('.obw-tip')).toContainText(
      'Học 30 phút mỗi ngày giúp bạn tăng tốc',
    );
    await page.getByLabel('Giờ học mỗi ngày').selectOption('20:00');
    await expect(summary.locator('#sum-time')).toHaveText('20:00');
    await page.getByRole('switch', { name: /nhắc nhở học tập/i }).click();
    await expect(summary.locator('#sum-remind')).toHaveText('Tắt');

    // One copy of every interactive control (the web layout is CSS only).
    await expect(page.locator('[role="radio"]')).toHaveCount(3);
    await expect(page.locator('input[type="radio"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Tiếp tục' })).toHaveCount(1);

    await expectTouchTargets(
      page,
      '.w-pubnav a, .obw-minute, .obw-time select, .obw-remind .switch, .obw-summary .btn',
      'plan',
    );
    await expectNoHorizontalOverflow(page, 'plan@1024');
    await expectAxeClean(page, 'plan');
  });

  test('plan screen: Tab runs nav (back, brand) then the plan controls', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/onboarding/plan?purpose=hsk_exam&band=1');
    await expect(page.locator('.w-pubnav')).toBeVisible();

    await page.keyboard.press('Tab');
    await expect(
      page.locator('.w-pubnav').getByRole('link', { name: 'Quay lại' }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Hán Lộ' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('radio', { name: /15/ })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('combobox', { name: 'Giờ học mỗi ngày' }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('switch', { name: /nhắc nhở học tập/i }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Tiếp tục' })).toBeFocused();
  });

  test('below 1024px the mobile chrome stays and every web part is hidden', async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await registerReadyLearner(page, baseURL);
    for (const route of [
      '/onboarding/goal',
      '/onboarding/plan?purpose=hsk_exam&band=1',
    ]) {
      await page.goto(route);
      await expect(page.locator('.ob__top')).toBeVisible();
      await expect(page.locator('.w-pubnav')).toBeHidden();
      await expect(page.locator('.obw-summary__panel')).toBeHidden();
      const visibleWebOnly = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.w-only'))
          .filter(
            (element) => window.getComputedStyle(element).display !== 'none',
          )
          .map(
            (element) =>
              `${element.tagName.toLowerCase()}.${element.className}`,
          ),
      );
      expect(visibleWebOnly, `${route} .w-only at 390px`).toEqual([]);
      await expectNoHorizontalOverflow(page, `${route}@390`);
    }
  });

  // V1 (M2.10c vòng 2): vòng trước dùng `order` trên `.ob__section`/`.obw-when`
  // để đưa `.obw-tip` lên, nhưng selector đó cũng khớp h2 cấp độ của Mục tiêu
  // nên tiêu đề bị đẩy xuống dưới dãy cấp. Mẫu xếp: h2 → câu dẫn → dãy cấp →
  // thẻ thông tin.
  test('goal screen: tiêu đề cấp độ nằm trên dãy cấp và thẻ thông tin (V1)', async ({
    page,
    baseURL,
  }) => {
    await registerLearnerWithoutGoal(page, baseURL);
    await page.goto('/onboarding/goal');
    await expect(page.locator('.w-pubnav')).toBeVisible();

    const titleY = await boxY(
      page.getByRole('heading', {
        level: 2,
        name: 'Bạn muốn đạt trình độ HSK nào?',
      }),
      'h2 "Bạn muốn đạt trình độ HSK nào?"',
    );
    const hintY = await boxY(
      page.locator('.obw-col > .ob__sub--tight'),
      'câu dẫn "Chọn cấp độ mục tiêu"',
    );
    const levelsY = await boxY(page.locator('#levels'), 'dãy cấp độ');
    const infoY = await boxY(page.locator('.obw-info'), 'thẻ thông tin cấp');

    expect(titleY, 'h2 trên câu dẫn').toBeLessThan(hintY);
    expect(hintY, 'câu dẫn trên dãy cấp').toBeLessThan(levelsY);
    expect(levelsY, 'dãy cấp trên thẻ thông tin').toBeLessThan(infoY);
  });

  // V2: DOM mobile ngắt câu bằng `<br>`; ở web `<br>` bị ẩn nên khoảng trắng
  // phải có sẵn, nếu không hai từ dính nhau ("chúng tôiđề xuất").
  test('goal screen: <br> bị ẩn ở web để lại khoảng trắng (V2)', async ({
    page,
    baseURL,
  }) => {
    await registerLearnerWithoutGoal(page, baseURL);
    await page.goto('/onboarding/goal');
    await expect(page.locator('.w-pubnav')).toBeVisible();

    const lead = await rawInnerText(page.locator('.obw-col > .w-lead'));
    expect(lead).toContain('chúng tôi đề xuất');
    expect(lead).not.toContain('\n');

    const levelDesc = await rawInnerText(page.locator('#level-desc'));
    expect(levelDesc).toBe(
      'Có thể giao tiếp trong các tình huống hàng ngày đơn giản.',
    );
    expect(levelDesc).not.toContain('\n');

    // V5: ghi chú của mẫu dùng `#i-info` (không phải `#i-help-circle`).
    await expect(page.locator('.obw-summary__note use')).toHaveAttribute(
      'href',
      '#i-info',
    );
  });

  test('plan screen: <br> bị ẩn ở web để lại khoảng trắng (V2)', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/onboarding/plan?purpose=hsk_exam&band=1');
    await expect(page.locator('.w-pubnav')).toBeVisible();

    const h1 = await rawInnerText(page.locator('.obw-col > .w-h1'));
    expect(h1).toBe('Bạn muốn học mỗi ngày bao nhiêu phút?');
    expect(h1).not.toContain('\n');

    const tip = await rawInnerText(page.locator('.obw-tip__text'));
    expect(tip).toBe(
      'Học 15 phút mỗi ngày giúp bạn nhớ lâu hơn và tiến bộ bền vững.',
    );
    expect(tip).not.toContain('\n');
  });

  // V3: mẫu có mũi tên trong nút "Tiếp tục"; bản mobile không có nên SVG mang
  // `.w-only` và vòng trước mũi tên biến mất ở cả hai khổ web.
  test('nút "Tiếp tục" có mũi tên ở web và ẩn ở 390 (V3)', async ({
    page,
    baseURL,
  }) => {
    for (const [route, register, arrowLabel] of [
      ['/onboarding/goal', registerLearnerWithoutGoal, 'Mục tiêu'],
      [
        '/onboarding/plan?purpose=hsk_exam&band=1',
        registerReadyLearner,
        'Kế hoạch',
      ],
    ] as const) {
      await register(page, baseURL);
      await page.goto(route);
      const arrow = page.locator('.obw-summary .obw-cta__arrow');
      await expect(arrow, arrowLabel).toBeVisible();
      await expect(arrow.locator('use'), arrowLabel).toHaveAttribute(
        'href',
        '#i-arrow-right',
      );
      const box = await arrow.boundingBox();
      expect(box, `${arrowLabel}: mũi tên có hộp`).not.toBeNull();
      expect(
        box?.width ?? 0,
        `${arrowLabel}: mũi tên có bề rộng`,
      ).toBeGreaterThan(0);
    }

    // 390px: giữ nguyên bản mobile — mũi tên không hiện.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/onboarding/goal');
    await expect(page.locator('.obw-cta__arrow')).toBeHidden();
  });

  // V4: mẫu dùng nền `body.web` --cream-50; `.learner-app` lại đổi sang
  // --cream-100 từ 768px nên ở 1440 thấy hai dải hai bên khung 1280px (ở 1024
  // khung phủ kín chiều ngang nên không có dải). Đo ở cả hai project desktop.
  // R1: mẫu không có bóng đổ desktop trên `main.w-wrap.obw-body`, còn
  // `learner.css:638-640` đặt `--shadow-app-desktop` cho `.app` từ 768px.
  test('onboarding: nền khung đồng một màu như mẫu (V4) và khung không bóng đổ desktop (R1)', async ({
    page,
    baseURL,
  }) => {
    await registerLearnerWithoutGoal(page, baseURL);
    await page.goto('/onboarding/goal');
    await expect(page.locator('.w-pubnav')).toBeVisible();

    const sample = await page.evaluate(() => {
      const effectiveBackground = (x: number, y: number) => {
        let element = document.elementFromPoint(x, y);
        while (element) {
          const background = window.getComputedStyle(element).backgroundColor;
          if (background && background !== 'transparent') {
            const parts = background.match(/[\d.]+/g)?.map(Number) ?? [];
            const alpha = parts.length === 4 ? (parts[3] ?? 1) : 1;
            if (alpha > 0) {
              return { color: background, element: element.tagName };
            }
          }
          element = element.parentElement;
        }
        return { color: 'none', element: 'none' };
      };
      const nav = document.querySelector('.w-pubnav');
      if (!nav) return null;
      const navBox = nav.getBoundingClientRect();
      const y = Math.round(navBox.bottom + 20);
      return {
        y,
        left: effectiveBackground(20, y),
        center: effectiveBackground(Math.round(window.innerWidth / 2), y),
        viewportWidth: window.innerWidth,
      };
    });

    expect(sample, 'đo được nền').not.toBeNull();
    expect([1024, 1440]).toContain(sample!.viewportWidth);
    expect(
      sample!.left.color,
      `nền x=20 so với giữa trang (y=${sample!.y})`,
    ).toBe(sample!.center.color);
    // Nền mẫu `body.web` (web.css) = --cream-50.
    expect(sample!.left.color).toBe('rgb(254, 250, 242)');

    // R1: bỏ bóng đổ desktop của `.app` ở cả hai màn onboarding.
    expect(await shadowOf(page), 'bóng goal ở web').toBe('none');
    await registerReadyLearner(page, baseURL);
    await page.goto('/onboarding/plan?purpose=hsk_exam&band=1');
    await expect(page.locator('.w-pubnav')).toBeVisible();
    expect(await shadowOf(page), 'bóng plan ở web').toBe('none');

    // Dưới 1024px: rule nằm trong media ≥1024 nên không rò. 768 là chỗ bắt
    // được rò (learner.css đặt bóng từ 768px); 390 vốn không có bóng.
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/onboarding/goal');
    expect(await shadowOf(page), 'bóng goal ở 768').not.toBe('none');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/onboarding/goal');
    expect(await shadowOf(page), 'bóng goal ở 390').toBe('none');
  });
});
