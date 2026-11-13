import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

import { readCspViolations, watchCsp } from './support/learner-fixtures';

// M2.10c (PO Q81): từ 1024px 10 trang công khai của learner dùng khung
// `.w-public` (nav ngang + `.w-authpage`/`.w-auth` 2 cột). Chỉ desktop-1024 và
// desktop-1440 chạy `@web`; dưới 1024px trang giữ nguyên bản mobile (K3a) nên
// các project mobile/tablet bỏ qua spec này.
//
// Spec tự tạo trạng thái của mình (không dựa seed của spec khác): trang auth
// không đọc DB, trừ lượt "gửi liên kết" của forgot-password — BFF trả 204 cho
// mọi email (Q71, không tiết lộ email có tồn tại) nên chỉ cần email riêng.

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// 43 ký tự [A-Za-z0-9_-] đúng định dạng token của liên kết trong email; trang
// chỉ kiểm định dạng ở client nên hiện được view form mà không gọi API.
const LINK_TOKEN = `e2e-web-auth-${'a'.repeat(43 - 'e2e-web-auth-'.length)}`;

const ROUTES = [
  '/sign-in',
  '/sign-up',
  '/forgot-password',
  `/reset-password#token=${LINK_TOKEN}`,
  '/verify-email',
];

function pubnav(page: Page): Locator {
  return page.locator('header.w-pubnav.wa-nav');
}

function art(page: Page): Locator {
  return page.locator('.w-auth__art');
}

/** Mỗi test nói bằng IP riêng: backend giới hạn theo IP (learner-fixtures). */
async function ownClientIp(page: Page): Promise<void> {
  await page.setExtraHTTPHeaders({
    'x-forwarded-for': `10.${Math.floor(Math.random() * 256)}.${Math.floor(
      Math.random() * 256,
    )}.${1 + Math.floor(Math.random() * 254)}`,
  });
}

test.describe('Learner web public auth (M2.10c) @web', () => {
  test('nav ngang thay chrome mobile và khung hai cột hiện trên 5 route', async ({
    page,
  }) => {
    for (const route of ROUTES) {
      await page.goto(route);
      await expect(pubnav(page), route).toBeVisible();
      await expect(page.locator('.tabbar'), route).toBeHidden();
      await expect(art(page), route).toBeVisible();

      // `.w-auth`: thẻ 2 cột của mẫu, cột form bên trái, art navy bên phải.
      const columns = await page.evaluate(() => {
        const card = document.querySelector('main.auth');
        const artEl = document.querySelector('.w-auth__art');
        if (!card || !artEl) return null;
        const cardBox = card.getBoundingClientRect();
        const artBox = artEl.getBoundingClientRect();
        return {
          grid: getComputedStyle(card).gridTemplateColumns.split(' ').length,
          artLeft: Math.round(artBox.left),
          cardMiddle: Math.round(cardBox.left + cardBox.width / 2),
          navHeight: Math.round(
            document.querySelector('header.w-pubnav')!.getBoundingClientRect()
              .height,
          ),
        };
      });
      expect(columns, route).not.toBeNull();
      expect(columns!.grid, route).toBe(2);
      expect(columns!.artLeft, route).toBe(columns!.cardMiddle);
      expect(columns!.navHeight, route).toBe(72);

      // Chrome mobile (nút quay lại icon) không còn trong luồng.
      await expect(page.locator('a.auth__back'), route).toBeHidden();
    }
  });

  test('link nav, nút quay lại và link pháp lý trỏ đúng đích', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await expect(pubnav(page).locator('a.w-brand')).toHaveAttribute(
      'href',
      '/',
    );
    await expect(pubnav(page).locator('a.wa-home')).toHaveAttribute(
      'href',
      '/',
    );
    const signInSwitch = page.locator('p.wa-switch');
    await expect(signInSwitch).toContainText('Chưa có tài khoản?');
    await expect(signInSwitch.locator('a')).toHaveAttribute('href', '/sign-up');
    await expect(signInSwitch.locator('a')).toHaveText('Tạo tài khoản');
    await expect(
      page.getByRole('link', { name: 'Điều khoản sử dụng' }),
    ).toHaveAttribute('href', '/terms');
    await expect(
      page.getByRole('link', { name: 'Chính sách bảo mật' }),
    ).toHaveAttribute('href', '/privacy');

    await page.goto('/sign-up');
    const signUpSwitch = page.locator('p.wa-switch');
    await expect(signUpSwitch).toContainText('Đã có tài khoản?');
    await expect(signUpSwitch.locator('a')).toHaveAttribute('href', '/sign-in');
    await expect(signUpSwitch.locator('a')).toHaveText('Đăng nhập');

    for (const route of [
      '/forgot-password',
      '/reset-password',
      '/verify-email',
    ]) {
      await page.goto(route);
      await expect(pubnav(page).locator('a.wa-home'), route).toHaveAttribute(
        'href',
        '/',
      );
      await expect(page.locator('a.wa-back'), route).toHaveAttribute(
        'href',
        '/sign-in',
      );
    }
  });

  test('mọi link/nút hiện trên 5 route đạt vùng chạm 44px', async ({
    page,
  }) => {
    for (const route of ROUTES) {
      await page.goto(route);
      const small = await page.evaluate(() =>
        [
          ...document.querySelectorAll(
            '.w-public a, .w-public button, .w-public input',
          ),
        ]
          .filter((el) => el.checkVisibility())
          .map((el) => {
            const box = el.getBoundingClientRect();
            return {
              tag: el.tagName,
              cls: el.className,
              text: (el.textContent ?? '').trim().slice(0, 24),
              h: +box.height.toFixed(1),
              w: +box.width.toFixed(1),
            };
          })
          .filter((item) => item.h < 43.9 || item.w < 24),
      );
      expect(small, route).toEqual([]);
    }
  });

  test('không tràn ngang ở 1024px và 1440px', async ({ page }) => {
    for (const route of ROUTES) {
      await page.goto(route);
      const layout = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(layout.scrollWidth, route).toBeLessThanOrEqual(layout.clientWidth);
    }
  });

  test('thứ tự Tab đi từ nav công khai xuống nội dung', async ({ page }) => {
    await page.goto('/sign-in');
    await page.keyboard.press('Tab');
    await expect(page.locator('a.w-brand')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('a.wa-home')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Email')).toBeFocused();

    await page.goto('/forgot-password');
    await page.keyboard.press('Tab');
    await expect(page.locator('a.w-brand')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('a.wa-home')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('a.wa-back')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Email')).toBeFocused();
  });

  test('nút chính jade-800, chữ trắng, cao >= 44px trên 4 route có nút', async ({
    page,
  }) => {
    const states: Array<[string, string]> = [
      ['/sign-in', '.auth__submit'],
      ['/sign-up', '.auth__submit'],
      ['/forgot-password', '.auth__submit'],
      [`/reset-password#token=${LINK_TOKEN}`, '.auth__submit'],
    ];
    for (const [route, selector] of states) {
      await page.goto(route);
      const button = page.locator(selector);
      await expect(button, route).toHaveCSS(
        'background-color',
        'rgb(6, 122, 96)',
      );
      await expect(button, route).toHaveCSS('color', 'rgb(255, 255, 255)');
      const box = await button.boundingBox();
      expect(box?.height ?? 0, route).toBeGreaterThanOrEqual(43.9);
    }

    await page.goto('/verify-email');
    const action = page.locator('.auth__actions .btn');
    await expect(action).toHaveCSS('background-color', 'rgb(6, 122, 96)');
    const actionBox = await action.boundingBox();
    expect(actionBox?.height ?? 0).toBeGreaterThanOrEqual(43.9);
  });

  test('năm trạng thái của nhóm auth dựng đúng khung web', async ({ page }) => {
    // 1. Đăng nhập.
    await page.goto('/sign-in');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Chào mừng đến với Hán Lộ' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đăng nhập' })).toBeVisible();

    // 2. Đăng ký.
    await page.goto('/sign-up');
    await expect(
      page.getByRole('button', { name: 'Tạo tài khoản' }),
    ).toBeVisible();

    // 3. Quên mật khẩu: gửi xong là trạng thái `sent` (Q71), cùng một câu cho
    // mọi email, kèm gợi ý Spam chỉ có ở bản web.
    await ownClientIp(page);
    const csp = await watchCsp(page);
    await page.goto('/forgot-password');
    const email = `learner.web.auth.${Date.now()}@example.test`;
    await page.getByLabel('Email', { exact: true }).fill(`  ${email} `);
    await page.getByRole('button', { name: 'Gửi liên kết' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Kiểm tra email của bạn' }),
    ).toBeVisible();
    await expect(page.locator('.auth__subtitle strong')).toHaveText(email);
    await expect(page.locator('.auth__subtitle')).toContainText(
      `Nếu ${email} có tài khoản Hán Lộ, chúng tôi đã gửi liên kết đặt lại mật khẩu.`,
    );
    await expect(page.locator('p.wa-note')).toBeVisible();
    await expect(page.locator('p.wa-note')).toHaveText(
      'Không thấy email? Hãy xem cả mục Spam.',
    );
    await expect(pubnav(page)).toBeVisible();
    expect(csp).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);

    // 4. Đặt lại mật khẩu không có token -> `invalid`.
    await page.goto('/reset-password');
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Liên kết không còn hiệu lực',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Gửi liên kết mới' }),
    ).toHaveAttribute('href', '/forgot-password');

    // 5. Xác thực email không có token -> `invalid` (Q73, ẩn danh).
    await page.goto('/verify-email');
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Liên kết không còn hiệu lực',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Đăng nhập để gửi lại' }),
    ).toHaveAttribute('href', '/sign-in?next=verify-email');

    // `#sent` của forgot giữ nguyên khung: nav + cột art vẫn hiện.
    await page.goto('/forgot-password');
    await expect(art(page)).toBeVisible();
  });

  test('axe WCAG 2.1 AA sạch trên 5 route và 2 trạng thái invalid', async ({
    page,
  }) => {
    const axeRoutes = [...ROUTES, '/reset-password', '/verify-email'];
    for (const route of axeRoutes) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const { violations } = await new AxeBuilder({ page })
        .withTags(AXE_TAGS)
        .analyze();
      expect
        .soft(
          violations.map(
            (v) =>
              `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
          ),
          `axe ${route}`,
        )
        .toEqual([]);
    }
  });

  test('mobile dưới 1024px giữ nguyên: không có nav web, khung mobile còn nguyên', async ({
    page,
  }) => {
    // Test này chỉ có nghĩa khi viewport < 1024px; project desktop vẫn chạy
    // được nhờ thu nhỏ viewport, nên nó luôn kiểm tra đúng điều kiện K3a.
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of ['/sign-in', '/sign-up', '/forgot-password']) {
      await page.goto(route);
      await expect(pubnav(page), route).toBeHidden();
      await expect(art(page), route).toBeHidden();
      await expect(page.locator('a.auth__back'), route).toBeVisible();
      const layout = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(layout.scrollWidth, route).toBeLessThanOrEqual(layout.clientWidth);
    }
  });

  // V2 (M2.10c vòng 2): `.auth__terms` ngắt dòng bằng `<br>` ở bản mobile; ở
  // web `<br>` bị ẩn nên khoảng trắng phải có sẵn trong câu.
  test('câu điều khoản ở web không dính chữ khi <br> bị ẩn (V2)', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await expect(pubnav(page)).toBeVisible();
    const terms = await page
      .locator('.auth__terms')
      .evaluate((element) => (element as HTMLElement).innerText);
    expect(terms).toBe(
      'Bằng việc tiếp tục, bạn đồng ý với Điều khoản sử dụng và Chính sách bảo mật',
    );
    expect(terms).not.toContain('\n');

    // V5: `.wa-points` của mẫu dùng `#i-check-circle-line`.
    await expect(page.locator('.wa-points use').first()).toHaveAttribute(
      'href',
      '#i-check-circle-line',
    );
  });

  // V6 (M2.10c vòng 2): `web/verify-email.html` không có `.wa-back`, khác
  // forgot/reset-password. Mobile không đổi (link vốn mang `.w-only`).
  test('/verify-email ẩn "Quay lại đăng nhập" ở web (V6)', async ({ page }) => {
    for (const route of [
      '/forgot-password',
      `/reset-password#token=${LINK_TOKEN}`,
    ]) {
      await page.goto(route);
      await expect(page.locator('a.wa-back'), route).toBeVisible();
    }

    await page.goto('/verify-email');
    await expect(pubnav(page)).toBeVisible();
    // Vẫn còn trong DOM (page spec khẳng định), chỉ không hiện.
    await expect(page.locator('a.wa-back')).toHaveCount(1);
    await expect(page.locator('a.wa-back')).toBeHidden();

    // 390px: như trước — link web ẩn, nút quay lại của chrome mobile hiện.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/verify-email');
    await expect(page.locator('a.wa-back')).toBeHidden();
    await expect(page.locator('a.auth__back')).toBeVisible();
  });
});
