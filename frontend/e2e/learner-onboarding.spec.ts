import { expect, test, type Locator } from '@playwright/test';

import {
  disposableDbUrl,
  queryDisposableDb,
  sqlLiteral,
} from './support/disposable-db';

test.use({
  viewport: { width: 390, height: 844 },
});

type FocusStyle = {
  boxShadow: string;
  outlineStyle: string;
  outlineWidth: string;
  outlineColor: string;
};

async function readFocusStyle(locator: Locator): Promise<FocusStyle> {
  return locator.evaluate((node) => {
    const style = window.getComputedStyle(node);
    return {
      boxShadow: style.boxShadow,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
    };
  });
}

// Q12: every learner control shows a solid jade-700 ring (no alpha) on focus.
const SOLID_JADE_700 = /rgb\(2, 142, 106\)/;

async function expectKeyboardFocusVisible(locator: Locator): Promise<void> {
  await expect(locator).toBeFocused();
  expect(await locator.evaluate((node) => node.matches(':focus-visible'))).toBe(
    true,
  );
}

const VIEWPORTS_8 = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 844, height: 390 },
];

test.describe('Learner Onboarding Flow', () => {
  test('1. completes onboarding from goal to plan to learn with persistence across reload and browser back', async ({
    page,
  }) => {
    const email = `learner.ob1.${Date.now()}.${Math.floor(Math.random() * 10000)}@example.test`;
    const password = 'StrongPassword123!';

    await page.goto('/sign-up');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();

    await expect(page).toHaveURL(/\/onboarding\/goal/);
    await expect(page).toHaveTitle('Mục tiêu học tập · Hán Lộ');

    // Q9: no back button for new learners without goal
    await expect(page.getByRole('link', { name: 'Quay lại' })).toHaveCount(0);

    // Select "Thi lấy chứng chỉ HSK" + Band 1
    await page.getByRole('radio', { name: /Thi/ }).click();
    await page.getByRole('radio', { name: '1' }).click();
    await expect(page).toHaveURL(/\/onboarding\/goal\?purpose=hsk_exam&band=1/);

    // Goal selection survives a full reload (URL is the source of truth)
    await page.reload();
    await expect(page).toHaveURL(/\/onboarding\/goal\?purpose=hsk_exam&band=1/);
    await expect(page.getByRole('radio', { name: /Thi/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(
      page.getByRole('radio', { name: /Giao tiếp/ }),
    ).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('radio', { name: '1' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('radio', { name: '3' })).toHaveAttribute(
      'aria-checked',
      'false',
    );

    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await expect(page).toHaveURL(/\/onboarding\/plan\?purpose=hsk_exam&band=1/);

    // Browser Back returns to the goal page with the same selection
    await page.goBack();
    await expect(page).toHaveURL(/\/onboarding\/goal\?purpose=hsk_exam&band=1/);
    await expect(page.getByRole('radio', { name: /Thi/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(
      page.getByRole('radio', { name: /Giao tiếp/ }),
    ).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('radio', { name: '1' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('radio', { name: '3' })).toHaveAttribute(
      'aria-checked',
      'false',
    );

    await page.getByRole('button', { name: 'Tiếp tục' }).click();

    // Plan URL reflects parameters
    await expect(page).toHaveURL(/\/onboarding\/plan\?purpose=hsk_exam&band=1/);
    await expect(page).toHaveTitle('Kế hoạch học mỗi ngày · Hán Lộ');

    // Reload persists URL and parameters
    await page.reload();
    await expect(page).toHaveURL(/\/onboarding\/plan\?purpose=hsk_exam&band=1/);

    // Select 30 minutes + 07:00
    await page.getByRole('radio', { name: /30/ }).click();
    await page.getByLabel('Giờ học mỗi ngày').selectOption('07:00');

    await page.getByRole('button', { name: 'Tiếp tục' }).click();

    // Navigates to /learn with user email
    await expect(page).toHaveURL(/\/learn/);
    await expect(page).toHaveTitle('Góc học tập · Hán Lộ');
    await expect(page.locator('h1')).toContainText(email);

    // Visiting /learn again stays on /learn
    await page.goto('/learn');
    await expect(page).toHaveURL(/\/learn/);
    await expect(page.locator('h1')).toContainText(email);
  });

  test('2. completes band 8 onboarding and re-opening goal page shows selection and back link to /learn, also with URL params', async ({
    page,
  }) => {
    const email = `learner.ob2.${Date.now()}.${Math.floor(Math.random() * 10000)}@example.test`;
    const password = 'StrongPassword123!';

    await page.goto('/sign-up');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();

    await expect(page).toHaveURL(/\/onboarding\/goal/);

    // Select "Thi lấy chứng chỉ HSK" + Band 8
    await page.getByRole('radio', { name: /Thi/ }).click();
    await page.getByRole('radio', { name: '8' }).click();
    await page.getByRole('button', { name: 'Tiếp tục' }).click();

    await expect(page).toHaveURL(/\/onboarding\/plan\?purpose=hsk_exam&band=8/);
    await page.getByRole('button', { name: 'Tiếp tục' }).click();

    await expect(page).toHaveURL(/\/learn/);

    // Re-open /onboarding/goal
    await page.goto('/onboarding/goal');
    await expect(page).toHaveURL(/\/onboarding\/goal/);
    await expect(page.getByRole('radio', { name: /Thi/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('radio', { name: '8' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    const backLink = page.getByRole('link', { name: 'Quay lại' });
    await expect(backLink).toBeVisible();
    await expect(backLink).toHaveAttribute('href', '/learn');

    // Ready learner with explicit URL selection: URL wins for the form,
    // but the back link still points to /learn because a goal exists.
    await page.goto('/onboarding/goal?purpose=work&band=3');
    await expect(page).toHaveURL(/\/onboarding\/goal\?purpose=work&band=3/);
    const backLinkWithParams = page.getByRole('link', { name: 'Quay lại' });
    await expect(backLinkWithParams).toBeVisible();
    await expect(backLinkWithParams).toHaveAttribute('href', '/learn');
    await expect(
      page.getByRole('radio', { name: /Công việc/ }),
    ).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: /Thi/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(page.getByRole('radio', { name: '3' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('radio', { name: '8' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  test('3. handles band 2 content_unavailable error with notice alert on return to /learn', async ({
    page,
  }) => {
    const email = `learner.ob3.${Date.now()}.${Math.floor(Math.random() * 10000)}@example.test`;
    const password = 'StrongPassword123!';

    await page.goto('/sign-up');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();

    await expect(page).toHaveURL(/\/onboarding\/goal/);

    // Band 2 is published without lessons in test seed
    await page.getByRole('radio', { name: '2' }).click();
    await page.getByRole('button', { name: 'Tiếp tục' }).click();

    await expect(page).toHaveURL(
      /\/onboarding\/plan\?purpose=communication&band=2/,
    );
    await page.getByRole('button', { name: 'Tiếp tục' }).click();

    // Error alert with link on plan page
    const alert = page.locator('.alert--error');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(
      'Đã lưu mục tiêu nhưng cấp độ này chưa có bài học. Hãy chọn cấp độ khác.',
    );
    const switchBandLink = alert.getByRole('link', {
      name: 'Chọn cấp độ khác',
    });
    await expect(switchBandLink).toBeVisible();

    // Navigating to /learn redirects to /onboarding/goal?notice=content_unavailable
    await page.goto('/learn');
    await expect(page).toHaveURL(
      /\/onboarding\/goal\?notice=content_unavailable/,
    );
    await expect(page.locator('.alert')).toContainText(
      'Cấp độ bạn chọn hiện chưa có bài học. Hãy chọn cấp độ khác.',
    );
  });

  test('4. disables continuation when selecting unreleased band 5 and shows alert', async ({
    page,
  }) => {
    const email = `learner.ob4.${Date.now()}.${Math.floor(Math.random() * 10000)}@example.test`;
    const password = 'StrongPassword123!';

    await page.goto('/sign-up');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();

    await expect(page).toHaveURL(/\/onboarding\/goal/);

    // Band 5 is not published
    await page.getByRole('radio', { name: '5' }).click();

    const alert = page.locator('.alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('HSK 5 chưa mở. Hãy chọn cấp độ khác.');

    const submitBtn = page.getByRole('button', { name: 'Tiếp tục' });
    await expect(submitBtn).toHaveAttribute('aria-disabled', 'true');

    await submitBtn.click({ force: true });
    await expect(page).toHaveURL(/\/onboarding\/goal/);
  });

  test('5. saves reminderEnabled=false and reminderTime null in database when reminder is disabled', async ({
    page,
  }) => {
    // Fail fast before the UI steps if the database is not disposable.
    disposableDbUrl();
    const email = `learner.ob5.${Date.now()}.${Math.floor(Math.random() * 10000)}@example.test`;
    const password = 'StrongPassword123!';

    await page.goto('/sign-up');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();

    await expect(page).toHaveURL(/\/onboarding\/goal/);
    await page.getByRole('button', { name: 'Tiếp tục' }).click();

    await expect(page).toHaveURL(/\/onboarding\/plan/);

    // Toggle reminder switch off
    const switchBtn = page.getByRole('switch', { name: /nhắc nhở học tập/i });
    await switchBtn.click();
    await expect(switchBtn).not.toBeChecked();

    await page.getByRole('button', { name: 'Tiếp tục' }).click();
    await expect(page).toHaveURL(/\/learn/);

    // Check database with psql (disposable test database only)
    const row = queryDisposableDb(
      [
        'SELECT ug."reminderEnabled", ug."reminderTime" IS NULL',
        'FROM "UserGoal" ug JOIN "User" u ON ug."userId" = u.id',
        `WHERE u.email = ${sqlLiteral(email)} AND ug."isActive" = true`,
        'ORDER BY ug.id DESC LIMIT 1;',
      ].join(' '),
    );
    expect(row).toBe('f|t');
  });

  test('6. validates responsive layout and touch target dimensions across 8 viewports', async ({
    page,
  }) => {
    const email = `learner.ob6.${Date.now()}.${Math.floor(Math.random() * 10000)}@example.test`;
    const password = 'StrongPassword123!';

    await page.goto('/sign-up');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();
    await expect(page).toHaveURL(/\/onboarding\/goal/);

    const routes = [
      '/onboarding/goal',
      '/onboarding/plan?purpose=communication&band=1',
    ];

    for (const route of routes) {
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

        const interactiveElements = await page
          .locator('a, button, input, select')
          .all();
        for (const el of interactiveElements) {
          if (await el.isVisible()) {
            const box = await el.boundingBox();
            if (box) {
              const isBandBtn = await el.evaluate(
                (node) =>
                  node.parentElement?.classList.contains('levels') ||
                  node.classList.contains('ob__band'),
              );
              if (isBandBtn) {
                expect(
                  box.width,
                  `Band width on ${route} at ${vp.width}x${vp.height}`,
                ).toBeGreaterThanOrEqual(23.9);
                expect(
                  box.height,
                  `Band height on ${route} at ${vp.width}x${vp.height}`,
                ).toBeGreaterThanOrEqual(43.9);
              } else {
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

  test('7. completes onboarding workflow entirely with keyboard navigation and visible focus', async ({
    page,
  }) => {
    // No transitions: computed styles are read synchronously after focus moves
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const email = `learner.ob7.${Date.now()}.${Math.floor(Math.random() * 10000)}@example.test`;
    const password = 'StrongPassword123!';

    await page.goto('/sign-up');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();
    await expect(page).toHaveURL(/\/onboarding\/goal/);

    // Keyboard navigation on /onboarding/goal:
    // Focus ring is compared on the same element focused (keyboard) vs not.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('radio', { name: /Giao tiếp/ })).toBeFocused();

    await page.keyboard.press('ArrowDown');
    const studyAbroad = page.getByRole('radio', { name: /Du học/ });
    await expectKeyboardFocusVisible(studyAbroad);
    // Roving tabindex: the arrow key already selects; Space only re-confirms
    // the focused choice, so it must keep the selection and focus unchanged.
    await expect(studyAbroad).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Space');
    await expect(studyAbroad).toHaveAttribute('aria-checked', 'true');
    await expect(studyAbroad).toBeFocused();
    const goalFocused = await readFocusStyle(studyAbroad);

    await page.keyboard.press('Tab');
    await expect(page.getByRole('radio', { name: '3' })).toBeFocused();
    await expect(studyAbroad).not.toBeFocused();
    await expect(studyAbroad).toHaveAttribute('aria-checked', 'true');
    const goalBlurred = await readFocusStyle(studyAbroad);
    expect(
      goalFocused,
      'selected purpose .goal focus ring must differ from selected-only state',
    ).not.toEqual(goalBlurred);

    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('radio', { name: '2' })).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    const band1 = page.getByRole('radio', { name: '1' });
    await expectKeyboardFocusVisible(band1);
    // Arrow keys select; Space re-confirms without moving focus or selection.
    await expect(band1).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Space');
    await expect(band1).toHaveAttribute('aria-checked', 'true');
    await expect(band1).toBeFocused();
    await expect(band1).toHaveCSS('box-shadow', SOLID_JADE_700);
    const levelFocused = await readFocusStyle(band1);

    await page.keyboard.press('Tab');
    const goalSubmit = page.getByRole('button', { name: 'Tiếp tục' });
    await expectKeyboardFocusVisible(goalSubmit);
    await expect(band1).toHaveAttribute('aria-checked', 'true');
    const levelBlurred = await readFocusStyle(band1);
    expect(
      levelFocused,
      'selected level button focus ring must differ from selected-only state',
    ).not.toEqual(levelBlurred);

    const goalSubmitFocused = await readFocusStyle(goalSubmit);
    await page.keyboard.press('Shift+Tab');
    await expect(band1).toBeFocused();
    const goalSubmitBlurred = await readFocusStyle(goalSubmit);
    expect(
      goalSubmitFocused,
      'Tiếp tục focus ring must differ from unfocused state',
    ).not.toEqual(goalSubmitBlurred);

    await page.keyboard.press('Tab');
    await expectKeyboardFocusVisible(goalSubmit);
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(
      /\/onboarding\/plan\?purpose=study_abroad&band=1/,
    );

    // Keyboard navigation on /onboarding/plan:
    await page.keyboard.press('Tab'); // back link
    await page.keyboard.press('Tab'); // active 15m option
    await expect(page.getByRole('radio', { name: /15/ })).toBeFocused();

    await page.keyboard.press('ArrowRight');
    const minute30 = page.getByRole('radio', { name: /30/ });
    await expectKeyboardFocusVisible(minute30);
    // Arrow keys select; Space re-confirms without moving focus or selection.
    await expect(minute30).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Space');
    await expect(minute30).toHaveAttribute('aria-checked', 'true');
    await expect(minute30).toBeFocused();
    const minuteFocused = await readFocusStyle(minute30);

    await page.keyboard.press('Tab'); // time select
    const timeSelect = page.getByRole('combobox');
    await expectKeyboardFocusVisible(timeSelect);
    await expect(timeSelect).toHaveCSS('box-shadow', SOLID_JADE_700);
    const selectFocused = await readFocusStyle(timeSelect);
    await expect(minute30).toHaveAttribute('aria-checked', 'true');
    const minuteBlurred = await readFocusStyle(minute30);
    expect(
      minuteFocused,
      'selected .minute focus ring must differ from selected-only state',
    ).not.toEqual(minuteBlurred);

    await page.keyboard.press('Tab'); // reminder switch
    const switchEl = page.getByRole('switch', { name: /nhắc nhở học tập/i });
    await expectKeyboardFocusVisible(switchEl);
    const selectBlurred = await readFocusStyle(timeSelect);
    expect(
      selectFocused,
      'time select focus ring must differ from its unfocused state',
    ).not.toEqual(selectBlurred);
    // Space is the control that changes the switch: toggle off, then back on
    // so the default reminder (on for a new learner) is kept for the flow.
    await expect(switchEl).toBeChecked();
    await page.keyboard.press('Space');
    await expect(switchEl).not.toBeChecked();
    await page.keyboard.press('Space');
    await expect(switchEl).toBeChecked();
    await expectKeyboardFocusVisible(switchEl);
    // The visible ring is drawn on the sibling track: input:focus-visible + span
    const switchTrack = switchEl.locator('xpath=following-sibling::span[1]');
    const switchFocused = await readFocusStyle(switchTrack);

    await page.keyboard.press('Tab'); // submit button
    const planSubmit = page.getByRole('button', { name: 'Tiếp tục' });
    await expectKeyboardFocusVisible(planSubmit);
    const switchBlurred = await readFocusStyle(switchTrack);
    expect(
      switchFocused,
      'reminder switch track focus ring must differ from unfocused state',
    ).not.toEqual(switchBlurred);

    const planSubmitFocused = await readFocusStyle(planSubmit);
    await page.keyboard.press('Shift+Tab');
    await expect(switchEl).toBeFocused();
    const planSubmitBlurred = await readFocusStyle(planSubmit);
    expect(
      planSubmitFocused,
      'plan Tiếp tục focus ring must differ from unfocused state',
    ).not.toEqual(planSubmitBlurred);

    await page.keyboard.press('Tab');
    await expectKeyboardFocusVisible(planSubmit);
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/learn/);
    await expect(page.locator('h1')).toContainText(email);
  });
  test('8. marks the selected level with a system color in forced colors mode', async ({
    page,
  }) => {
    const email = `learner.ob8.${Date.now()}.${Math.floor(Math.random() * 10000)}@example.test`;
    const password = 'StrongPassword123!';

    await page.goto('/sign-up');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Tạo tài khoản' }).click();
    await expect(page).toHaveURL(/\/onboarding\/goal/);

    await page.emulateMedia({ forcedColors: 'active' });
    const selected = page.getByRole('radio', { name: '3', exact: true });
    const unselected = page.getByRole('radio', { name: '2', exact: true });
    await expect(selected).toHaveAttribute('aria-checked', 'true');
    await expect(unselected).toHaveAttribute('aria-checked', 'false');

    // What is painted, not raw computed values: forced colors keeps the
    // author alpha, so a transparent background still shows as Canvas, and a
    // zero-width border or outline style none draws nothing.
    const readPaint = (locator: Locator) =>
      locator.evaluate((node) => {
        const probe = document.createElement('span');
        probe.style.backgroundColor = 'Canvas';
        document.body.append(probe);
        const canvas = window.getComputedStyle(probe).backgroundColor;
        probe.remove();
        const opaque = (color: string) =>
          /^rgba\(.*,\s*0\)$/.test(color) ? canvas : color;
        const style = window.getComputedStyle(node);
        return {
          background: opaque(style.backgroundColor),
          border:
            style.borderTopWidth === '0px'
              ? 'none'
              : opaque(style.borderTopColor),
          outline:
            style.outlineStyle === 'none' ? 'none' : opaque(style.outlineColor),
        };
      });
    const selectedPaint = await readPaint(selected);
    const unselectedPaint = await readPaint(unselected);
    expect(
      selectedPaint.background !== unselectedPaint.background ||
        selectedPaint.border !== unselectedPaint.border ||
        selectedPaint.outline !== unselectedPaint.outline,
      `selected level must differ from unselected by a system color: ${JSON.stringify({ selectedPaint, unselectedPaint })}`,
    ).toBe(true);

    // The number must stay readable: no forced Canvas over the Highlight
    // fill, text color differs from the fill, and the pixels show glyphs.
    const selectedText = await selected.evaluate((node) => {
      const style = window.getComputedStyle(node);
      return {
        forcedColorAdjust: style.forcedColorAdjust,
        color: style.color,
        backgroundColor: style.backgroundColor,
      };
    });
    expect(selectedText.forcedColorAdjust).toBe('none');
    expect(selectedText.color).not.toBe(selectedText.backgroundColor);
    // Center half of the button only: rounded corners and the page around
    // them would add colors even when no number is painted.
    const box = await selected.boundingBox();
    if (!box) throw new Error('selected level has no bounding box');
    const shot = (
      await page.screenshot({
        clip: {
          x: box.x + box.width / 4,
          y: box.y + box.height / 4,
          width: box.width / 2,
          height: box.height / 2,
        },
      })
    ).toString('base64');
    const distinctColors = await page.evaluate(async (png) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (!context) return 0;
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, image.width, image.height);
      const colors = new Set<string>();
      for (let i = 0; i < data.length; i += 4) {
        colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      }
      return colors.size;
    }, shot);
    expect(
      distinctColors,
      'selected level screenshot must show the number over its fill',
    ).toBeGreaterThanOrEqual(2);
  });
});
