import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

// M2.10c: khung công khai `.w-public` (PO Q81) — trang chào `/` và hai trang
// pháp lý `/terms`, `/privacy`. Chỉ desktop-1024 và desktop-1440 chạy
// (`@web` bị grepInvert ở mobile-390 và tablet-768, như learner-web.spec.ts).
//
// File này KHÔNG cần fixture dữ liệu, và đó là cách tự chứa mạnh nhất: ba
// route đều công khai, không đọc DB, không phụ thuộc seed hay fixture của spec
// khác (bài học F1 của M2.10d). Mọi bước đều idempotent và chạy lại được trên
// cùng một DB.

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const LANDING_NAV_ANCHORS = ['#levels', '#features', '#faq'];
const HERO_ACTIONS = ['/sign-up', '/sign-in'];

/** Ba nhóm link của mẫu `docs/ui_reference/web/index.html` + `terms.html`. */
const FOOTER_GROUPS: ReadonlyArray<
  readonly [group: string, links: ReadonlyArray<readonly [string, string]>]
> = [
  [
    'Giới thiệu',
    [
      ['Lộ trình HSK', '/#levels'],
      ['Tính năng', '/#features'],
      ['Câu hỏi thường gặp', '/#faq'],
    ],
  ],
  [
    'Tài khoản',
    [
      ['Đăng nhập', '/sign-in'],
      ['Đăng ký', '/sign-up'],
    ],
  ],
  [
    'Pháp lý',
    [
      ['Điều khoản sử dụng', '/terms'],
      ['Chính sách bảo mật', '/privacy'],
    ],
  ],
];

interface PublicRoute {
  path: string;
  h1: string;
  /** Selector có ít nhất một vùng chạm 44×44 trên route này. */
  touchTargets: string[];
}

const PUBLIC_ROUTES: readonly PublicRoute[] = [
  {
    path: '/',
    h1: 'Con đường chinh phục tiếng Trung',
    touchTargets: [
      '.w-pubnav a',
      '.lp-hero__cta a',
      '.lp-cta a',
      '.lp-faq summary',
      '.w-footer a',
    ],
  },
  {
    path: '/terms',
    h1: 'Điều khoản sử dụng',
    touchTargets: [
      '.w-pubnav a',
      '.legal__toc a',
      '.legal__back',
      '.w-footer a',
    ],
  },
  {
    path: '/privacy',
    h1: 'Chính sách bảo mật',
    touchTargets: [
      '.w-pubnav a',
      '.legal__toc a',
      '.legal__back',
      '.w-footer a',
    ],
  },
];

function pubnav(page: Page): Locator {
  return page.locator('.w-pubnav');
}

function footer(page: Page): Locator {
  return page.locator('footer.w-footer');
}

async function hrefs(locator: Locator): Promise<Array<string | null>> {
  return locator.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('href')),
  );
}

/** Như learner-web.spec.ts: mọi vùng chạm hiển thị đều ≥ 44×44. */
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
    const name = (
      (await target.getAttribute('aria-label')) ??
      (await target.textContent()) ??
      ''
    )
      .trim()
      .replace(/\s+/gu, ' ')
      .slice(0, 30);
    const box = await target.boundingBox();
    expect(box, `${label}: ${selector} "${name}" has a box`).not.toBeNull();
    if (!box) continue;
    expect
      .soft(box.width, `${label}: ${selector} "${name}" width`)
      .toBeGreaterThanOrEqual(44);
    expect
      .soft(box.height, `${label}: ${selector} "${name}" height`)
      .toBeGreaterThanOrEqual(44);
  }
}

async function horizontalOverflow(page: Page): Promise<{
  scrollWidth: number;
  clientWidth: number;
}> {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

test.describe('Learner web public frame (M2.10c) @web', () => {
  test.describe.configure({ timeout: 90_000 });

  test('the public frame replaces the tab bar on the three routes', async ({
    page,
  }) => {
    for (const route of PUBLIC_ROUTES) {
      await page.goto(route.path);
      await expect(pubnav(page), `pubnav ${route.path}`).toBeVisible();
      await expect(
        page.locator('.tabbar'),
        `tab bar ${route.path}`,
      ).toBeHidden();
      await expect(footer(page), `footer ${route.path}`).toBeVisible();
      // Một `<main>` duy nhất trong DOM (learner-a11y.spec.ts đếm theo DOM,
      // không lọc hiển thị) và đúng một h1 nhìn thấy.
      expect(
        await page.locator('main').count(),
        `main count ${route.path}`,
      ).toBe(1);
      await expect(
        page.locator('h1:visible'),
        `visible h1 ${route.path}`,
      ).toHaveText(route.h1);
      // Không còn chrome mobile nào lọt lên web.
      await expect(
        page.locator('.appbar'),
        `appbar ${route.path}`,
      ).toBeHidden();
    }
  });

  test('landing nav links point at the real anchors (Q84)', async ({
    page,
  }) => {
    await page.goto('/');
    const nav = pubnav(page).getByRole('navigation', { name: 'Giới thiệu' });
    await expect(nav).toBeVisible();
    expect(await hrefs(nav.getByRole('link'))).toEqual(LANDING_NAV_ANCHORS);
    for (const anchor of LANDING_NAV_ANCHORS) {
      await expect(page.locator(anchor)).toHaveCount(1);
    }
    expect(await hrefs(page.locator('.lp-hero__cta a'))).toEqual(HERO_ACTIONS);
    // Ba lời gọi "Bắt đầu học" của mẫu: nav, hero và CTA cuối trang.
    expect(
      await hrefs(page.getByRole('link', { name: 'Bắt đầu học' })),
    ).toEqual(['/sign-up', '/sign-up', '/sign-up']);
  });

  test('legal nav, table of contents and footer link to the right places', async ({
    page,
  }) => {
    await page.goto('/terms');
    expect(await hrefs(page.locator('.w-pubnav__end a'))).toEqual(['/sign-in']);
    expect(await hrefs(page.locator('.legal__toc a'))).toEqual([
      '/terms',
      '/privacy',
    ]);
    await expect(
      page.locator('.legal__toc a[aria-current="page"]'),
      'aria-current /terms',
    ).toHaveText(/Điều khoản sử dụng/u);
    await expect(page.locator('.legal__back')).toHaveAttribute('href', '/');
    await expect(page.locator('.legal__see a')).toHaveAttribute(
      'href',
      '/privacy',
    );
    await expect(
      page.locator('.legal__empty'),
      'câu "Nội dung đang được cập nhật." của app',
    ).toContainText('Nội dung đang được cập nhật.');

    await page.goto('/privacy');
    await expect(
      page.locator('.legal__toc a[aria-current="page"]'),
      'aria-current /privacy',
    ).toHaveText(/Chính sách bảo mật/u);
    await expect(page.locator('.legal__see a')).toHaveAttribute(
      'href',
      '/terms',
    );
    await expect(page.locator('.legal__empty')).toContainText(
      'Nội dung đang được cập nhật.',
    );
  });

  test('footer carries the three sample groups on all three routes', async ({
    page,
  }) => {
    for (const route of PUBLIC_ROUTES) {
      await page.goto(route.path);
      await expect(
        footer(page).getByRole('link', { name: 'Hán Lộ' }),
        `brand ${route.path}`,
      ).toHaveAttribute('href', '/');
      await expect(footer(page), `copyright ${route.path}`).toContainText(
        '© 2026 Hán Lộ',
      );
      for (const [group, links] of FOOTER_GROUPS) {
        const nav = footer(page).getByRole('navigation', { name: group });
        await expect(nav, `${group} @ ${route.path}`).toBeVisible();
        for (const [label, href] of links) {
          await expect(
            nav.getByRole('link', { name: label }),
            `${label} @ ${route.path}`,
          ).toHaveAttribute('href', href);
        }
      }
    }
  });

  test('anchors scroll to the section and clear the sticky nav (88px)', async ({
    page,
  }) => {
    await page.goto('/');
    for (const anchor of LANDING_NAV_ANCHORS) {
      await page.locator(`.w-pubnav nav a[href="${anchor}"]`).click();
      await expect(page).toHaveURL(new RegExp(`${anchor}$`, 'u'));
      const { top, atBottom } = await page
        .locator(anchor)
        .evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return {
            top: Math.round(rect.top),
            atBottom:
              window.scrollY + window.innerHeight >=
              document.documentElement.scrollHeight - 1,
          };
        });
      // `scroll-margin-top: 88px` (thanh nav cao 72px) — cho phép 8px sai số.
      // `#faq` là mục cuối: trang đã cuộn hết nên đích dừng thấp hơn 88px,
      // khi đó chỉ cần không bị thanh nav che.
      expect(top, `${anchor} top`).toBeGreaterThanOrEqual(80);
      if (!atBottom) {
        expect(top, `${anchor} top`).toBeLessThanOrEqual(96);
      } else {
        expect(top, `${anchor} top at page bottom`).toBeGreaterThanOrEqual(72);
      }
    }
  });

  test('FAQ details open and close from the keyboard', async ({ page }) => {
    await page.goto('/');
    const details = page.locator('#faq details').first();
    const summary = details.locator('summary');
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(details).toHaveAttribute('open', '');
    await page.keyboard.press('Enter');
    await expect(details).not.toHaveAttribute('open', '');
    await page.keyboard.press('Space');
    await expect(details).toHaveAttribute('open', '');
  });

  test('touch targets are at least 44x44 (Q42/Q69)', async ({ page }) => {
    for (const route of PUBLIC_ROUTES) {
      await page.goto(route.path);
      for (const selector of route.touchTargets) {
        await expectTouchTargets(page, selector, route.path);
      }
    }
  });

  test('no horizontal overflow at 1024 and 1440', async ({ page }) => {
    for (const width of [1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of PUBLIC_ROUTES) {
        await page.goto(route.path);
        await expect(pubnav(page)).toBeVisible();
        const layout = await horizontalOverflow(page);
        expect
          .soft(
            layout.scrollWidth,
            `${route.path} at ${width} (scroll ${layout.scrollWidth} / client ${layout.clientWidth})`,
          )
          .toBeLessThanOrEqual(layout.clientWidth);
      }
    }
  });

  test('Tab order runs nav, then content, then footer', async ({ page }) => {
    for (const route of PUBLIC_ROUTES) {
      await page.setViewportSize({ width: 1024, height: 900 });
      await page.goto(route.path);
      const order: string[] = [];
      for (let i = 0; i < 60 && order.at(-1) !== 'footer'; i += 1) {
        await page.keyboard.press('Tab');
        order.push(
          await page.evaluate(() => {
            const element = document.activeElement;
            if (element?.closest('.w-pubnav')) return 'nav';
            if (element?.closest('footer.w-footer')) return 'footer';
            if (element?.closest('main')) return 'content';
            return 'other';
          }),
        );
      }
      expect(order.length, `tab stops ${route.path}`).toBeGreaterThan(4);
      expect(order[0], `first stop ${route.path}`).toBe('nav');
      expect(
        order.indexOf('content'),
        `content after nav ${route.path}`,
      ).toBeGreaterThan(order.lastIndexOf('nav'));
      expect(
        order.indexOf('footer'),
        `footer after content ${route.path}`,
      ).toBeGreaterThan(order.lastIndexOf('content'));
      expect(order, `no stray focus ${route.path}`).not.toContain('other');
    }
  });

  test('axe WCAG 2.1 AA is clean on the three public routes', async ({
    page,
  }) => {
    for (const route of PUBLIC_ROUTES) {
      await page.goto(route.path);
      await page.waitForLoadState('networkidle');
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
          `axe ${route.path}`,
        )
        .toEqual([]);
    }
  });

  test('axe WCAG 2.1 AA is clean with every FAQ open', async ({ page }) => {
    await page.goto('/');
    const summaries = page.locator('#faq summary');
    const count = await summaries.count();
    expect(count).toBe(5);
    for (let index = 0; index < count; index += 1) {
      await summaries.nth(index).click();
    }
    const { violations } = await new AxeBuilder({ page })
      .withTags(AXE_TAGS)
      .analyze();
    expect
      .soft(
        violations.map((violation) => violation.id),
        'axe faq open',
      )
      .toEqual([]);
  });
  // V2 (M2.10c vòng 2): cây mobile của `/` ngắt câu bằng `<br>` và bị `.m-only`
  // ẩn từ 1024px; hero web là chữ liền nên phải hiện đủ câu.
  test('cây mobile có <br> ẩn ở web, hero web hiện đủ câu (V2)', async ({
    page,
  }) => {
    await page.goto('/');
    const tagline = page.locator('.welcome__tagline');
    await expect(tagline).toHaveCount(1);
    await expect(tagline).toBeHidden();
    await expect(page.locator('.lp-hero__title')).toHaveText(
      'Con đường chinh phục tiếng Trung',
    );
  });

  // V5 (M2.10c vòng 2): ba hình trước đây vẽ tay trong
  // `learner-landing-icons.tsx` nay lấy từ sprite của `layout.tsx`.
  test('icon của mẫu lấy từ sprite: FAQ và bốn tính năng (V5)', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#faq summary use').first()).toHaveAttribute(
      'href',
      '#i-chevron-down',
    );
    const featureIcons = await page
      .locator('.lp-feature__icon use')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('href')),
      );
    expect(featureIcons).toContain('#i-target');
    expect(featureIcons).toContain('#i-clipboard-check');
  });
});
