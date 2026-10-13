import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

import { queryDisposableDb, sqlLiteral } from './support/disposable-db';
import {
  readyLessonId,
  registerReadyLearner,
} from './support/learner-fixtures';

// M2.10a: from 1024px the learner screens sit in the `.w-app` frame
// (sidebar + top bar, Q81). Only desktop-1024 and desktop-1440 run these
// (`@web` is skipped on the mobile and tablet projects).

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const TOAST_COMING_SOON = 'Tính năng sắp ra mắt.';

// A word of its own, so other specs' fixtures stay untouched.
const WORD = { hanzi: '网页框架', pinyin: 'wang3 ye4 kuang4 jia4' };

function wordId(): number {
  const read = () =>
    queryDisposableDb(
      `SELECT id FROM "Word" WHERE hanzi = ${sqlLiteral(WORD.hanzi)}`,
    );
  if (!read()) {
    queryDisposableDb(`WITH w AS (
        INSERT INTO "Word" (hanzi, pinyin, "pinyinNormalized", "pinyinTone", example, status, "isPure", "publishedAt", "updatedAt")
        VALUES (${sqlLiteral(WORD.hanzi)}, ${sqlLiteral(WORD.pinyin)}, 'wang ye kuang jia', 'wǎngyè kuàngjià',
          '这是网页框架。', 'published'::"ContentStatus", true, now(), now())
        RETURNING id),
      m AS (INSERT INTO "WordMeaning" ("wordId", "meaningOrder", "meaningVi", "meaningEn", "meaningViNormalized", "meaningEnNormalized", "updatedAt")
        SELECT id, 1, 'khung trang web', 'web frame', 'khung trang web', 'web frame', now() FROM w),
      l AS (INSERT INTO "WordLevel" ("wordId", "levelId") SELECT w.id, lv.id FROM w, "Level" lv WHERE lv.code = 'HSK1')
      SELECT id FROM w;`);
  }
  const id = Number(read());
  if (!id) throw new Error('web fixture word missing');
  return id;
}

function sidebar(page: Page): Locator {
  return page.locator('.w-side');
}

function mainNav(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Điều hướng chính' });
}

function topSearch(page: Page): Locator {
  return page.locator('.w-top').getByRole('searchbox', { name: 'Tra từ' });
}

function toast(page: Page): Locator {
  return page.locator('.toast-region[role="status"]');
}

// Reference values measured in the local samples (`docs/ui_reference/web`, not
// in git) with `chromium` before writing these tests: `web/css/web.css` caps
// `.w-content` at `calc(1200px + 2 x 40px)` and centres it in the main column,
// so the reported content width is 1200px at 1920x1080 (box x=452, w=1280 with
// the 264px sidebar); `web/home.html` `.home-explore` and `web/path.html`
// `.learn-grid` both resolve `repeat(4, minmax(0, 1fr))` to four tracks at
// 1280 and 1440.
const SAMPLE_CONTENT_MAX = 1200;
const SAMPLE_HOME_COLUMNS = 4;
const SAMPLE_PATH_COLUMNS = 4;
const MAIN_ROUTES = ['/learn', '/learn/path', '/learn/profile'];

type MainMeasure = {
  sidebarWidth: number;
  /** Raw bounding box of `main` — the path page keeps a transparent
   *  full-bleed subgrid wrapper, so this is only recorded for context. */
  boxX: number;
  boxWidth: number;
  /** Union of the painted descendants of `main`: the content block that
   *  web.css expresses as `.w-content` minus its 40px gutters. */
  contentX: number;
  contentWidth: number;
  mainColumnWidth: number;
};

/** Content block of `main`: union of its visible, painted descendants. */
async function measureMainBlock(page: Page): Promise<MainMeasure> {
  return page.evaluate(() => {
    const app = document.querySelector<HTMLElement>('.w-app');
    const side = document.querySelector<HTMLElement>('.w-app > .w-side');
    const main = document.querySelector<HTMLElement>('.w-app .app > main');
    if (!app || !side || !main) throw new Error('web frame is missing');
    const rect = main.getBoundingClientRect();
    const sidebarWidth = side.getBoundingClientRect().width;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    for (const element of Array.from(main.querySelectorAll('*'))) {
      if (!(element instanceof HTMLElement)) continue;
      if (element.closest('.sr-only') || !element.checkVisibility()) continue;
      const box = element.getBoundingClientRect();
      if (box.width < 4 || box.height < 4) continue;
      const style = getComputedStyle(element);
      const ownsText = Array.from(element.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      );
      const borderSides = ['Top', 'Right', 'Bottom', 'Left'] as const;
      const painted =
        ownsText ||
        style.backgroundImage !== 'none' ||
        style.boxShadow !== 'none' ||
        (style.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
          style.backgroundColor !== 'transparent') ||
        borderSides.some(
          (sideName) =>
            Number.parseFloat(style[`border${sideName}Width`]) > 0 &&
            style[`border${sideName}Style`] !== 'none',
        );
      if (!painted) continue;
      minX = Math.min(minX, box.x);
      maxX = Math.max(maxX, box.x + box.width);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
      throw new Error('main has no painted content');
    }
    return {
      sidebarWidth,
      boxX: rect.x,
      boxWidth: rect.width,
      contentX: minX,
      contentWidth: maxX - minX,
      mainColumnWidth: app.getBoundingClientRect().width - sidebarWidth,
    };
  });
}

/** Used track list of a grid, as `getComputedStyle().gridTemplateColumns`. */
async function gridTracks(page: Page, selector: string): Promise<string[]> {
  const value = await page
    .locator(selector)
    .evaluate((element) => getComputedStyle(element).gridTemplateColumns);
  return value.split(/\s+/u).filter((track) => track.length > 0);
}

type TextBox = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Indexes of collected ancestors, so nesting is not read as an overlap. */
  ancestors: number[];
};

/** Boxes of every element that owns visible text nodes (not clipped/hidden). */
async function textBoxes(page: Page): Promise<TextBox[]> {
  return page.evaluate(() => {
    const root = document.querySelector('.learner-app');
    if (!root) throw new Error('learner app root is missing');
    const collected = new Map<Element, number>();
    const boxes: TextBox[] = [];
    for (const element of Array.from(root.querySelectorAll('*'))) {
      const ownText = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join('')
        .trim();
      if (ownText.length === 0) continue;
      if (!(element instanceof HTMLElement) || !element.checkVisibility()) {
        continue;
      }
      // `.sr-only` text is clipped on purpose: it cannot collide visually.
      if (element.closest('.sr-only')) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      const ancestors: number[] = [];
      for (
        let parent = element.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        const index = collected.get(parent);
        if (index !== undefined) ancestors.push(index);
      }
      collected.set(element, boxes.length);
      boxes.push({
        text: ownText.slice(0, 30),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        ancestors,
      });
    }
    return boxes;
  });
}

/** Fails when two visible text boxes that are not nested overlap by > 1px. */
async function expectNoTextOverlap(page: Page, label: string): Promise<number> {
  const boxes = await textBoxes(page);
  const overlaps: string[] = [];
  for (let i = 0; i < boxes.length; i += 1) {
    const a = boxes[i];
    if (!a) continue;
    for (let j = i + 1; j < boxes.length; j += 1) {
      const b = boxes[j];
      if (!b) continue;
      if (a.ancestors.includes(j) || b.ancestors.includes(i)) continue;
      const dx = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const dy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (dx > 1 && dy > 1) {
        overlaps.push(
          `"${a.text}" x "${b.text}" (${dx.toFixed(1)}x${dy.toFixed(1)}px)`,
        );
      }
    }
  }
  expect(
    overlaps,
    `${label}: overlapping text (${boxes.length} boxes)`,
  ).toEqual([]);
  return boxes.length;
}

type FocusRing = {
  inSidebar: boolean;
  inTopbar: boolean;
  outlineStyle: string;
  outlineWidth: string;
  boxShadow: string;
};

async function activeFocusRing(page: Page): Promise<FocusRing> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element) throw new Error('no active element');
    const style = getComputedStyle(element);
    return {
      inSidebar: element.closest('.w-side') !== null,
      inTopbar: element.closest('.w-top') !== null,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow,
    };
  });
}

test.describe('Learner web frame (M2.10a) @web', () => {
  let lessonId = 0;
  let word = 0;
  let routes: string[] = [];

  test.describe.configure({ timeout: 90_000 });

  test.beforeAll(async () => {
    const hsk1 = await readyLessonId('HSK1');
    if (!hsk1) throw new Error('seed has no ready HSK1 lesson');
    lessonId = hsk1;
    word = wordId();
    routes = [
      '/learn',
      '/learn/path',
      '/learn/profile',
      '/learn/dictionary',
      `/learn/dictionary/${word}`,
    ];
  });

  test('sidebar replaces the tab bar and marks the current page', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    const expected: Array<[string, string]> = [
      ['/learn', 'Trang chủ'],
      ['/learn/path', 'Lộ trình học'],
      ['/learn/dictionary', 'Tra từ'],
    ];
    for (const [route, current] of expected) {
      await page.goto(route);
      await expect(sidebar(page)).toBeVisible();
      await expect(page.locator('.tabbar')).toBeHidden();
      // Only one "Điều hướng chính" is exposed: the sidebar one.
      await expect(mainNav(page)).toHaveCount(1);
      const nav = mainNav(page);
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(
        nav.getByRole('link', { name: current, exact: true }),
      ).toHaveAttribute('aria-current', 'page');
    }

    // Profile: no sidebar link is current, the profile cell is.
    await page.goto('/learn/profile');
    await expect(mainNav(page).locator('[aria-current="page"]')).toHaveCount(0);
    await expect(sidebar(page).locator('.w-side__me')).toHaveAttribute(
      'aria-current',
      'page',
    );

    // The lesson screens keep their current layout (M2.10b): no sidebar.
    await page.goto(`/learn/lessons/${lessonId}`);
    await expect(page.locator('.lesson-hero, main').first()).toBeVisible();
    await expect(sidebar(page)).toHaveCount(0);
    await expect(page.locator('.w-top')).toHaveCount(0);
    await expect(page.locator('.tabbar')).toBeVisible();
  });

  test('coming-soon items and Hỗ trợ toast; profile cell opens Hồ sơ', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/learn');
    const side = sidebar(page);
    for (const name of [
      'Ôn tập',
      'Thi thử HSK',
      'Phát âm',
      'Đọc hiểu',
      'Trợ lý AI',
    ]) {
      const button = side.getByRole('button', { name: `${name} Sắp có` });
      await expect(button.locator('.w-tag')).toHaveText('Sắp có');
      await button.click();
      await expect(toast(page)).toContainText(TOAST_COMING_SOON);
    }
    await side.getByRole('button', { name: 'Hỗ trợ', exact: true }).click();
    await expect(toast(page)).toContainText(TOAST_COMING_SOON);
    // Q82: no sign-out outside Hồ sơ.
    await expect(side.getByRole('button', { name: /Đăng xuất/u })).toHaveCount(
      0,
    );
    await side.locator('.w-side__me').click();
    await expect(page).toHaveURL(/\/learn\/profile$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hồ sơ');
  });

  test('Tab order runs sidebar, top bar, then main', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/learn/path');
    const order: string[] = [];
    for (let i = 0; i < 40 && order.at(-1) !== 'main'; i += 1) {
      await page.keyboard.press('Tab');
      order.push(
        await page.evaluate(() => {
          const el = document.activeElement;
          if (el?.closest('.w-side')) return 'side';
          if (el?.closest('.w-top')) return 'top';
          if (el?.closest('main')) return 'main';
          return 'other';
        }),
      );
    }
    const firstOf = (zone: string) => order.indexOf(zone);
    expect(firstOf('side')).toBe(0);
    expect(firstOf('top')).toBeGreaterThan(order.lastIndexOf('side'));
    expect(firstOf('main')).toBeGreaterThan(order.lastIndexOf('top'));
  });

  test('top bar search opens Tra từ with ?q=; Tra từ has no top search (Q85)', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.goto('/learn/path');
    await topSearch(page).fill('你好');
    await topSearch(page).press('Enter');
    await expect(page).toHaveURL(
      `/learn/dictionary?q=${encodeURIComponent('你好')}`,
    );
    await expect(
      page
        .locator('.dict-item')
        .first()
        .or(page.getByText('Không tìm thấy kết quả', { exact: false })),
    ).toBeVisible();
    await expect(page.locator('.w-top')).toBeVisible();
    await expect(page.locator('.w-top input, .w-search')).toHaveCount(0);
    // Only the page's own box is left with the name "Tra từ".
    const boxes = page.getByRole('searchbox', { name: 'Tra từ' });
    await expect(boxes).toHaveCount(1);
    await expect(
      page.locator('.dict-search').getByRole('searchbox'),
    ).toHaveCount(1);
  });

  test('no horizontal overflow on the five framed routes', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    for (const route of routes) {
      await page.goto(route);
      await expect(sidebar(page)).toBeVisible();
      const layout = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(layout.scrollWidth, route).toBeLessThanOrEqual(layout.clientWidth);
    }
  });

  test('axe WCAG 2.1 AA and distinct landmark names on the framed routes', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    for (const route of routes) {
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
      const navNames = await page
        .getByRole('navigation')
        .evaluateAll((navs) =>
          navs
            .filter((nav) => nav.checkVisibility())
            .map(
              (nav) =>
                nav.getAttribute('aria-label') ??
                document.getElementById(
                  nav.getAttribute('aria-labelledby') ?? '',
                )?.textContent ??
                '',
            ),
        );
      expect.soft(navNames.length, `navs ${route}`).toBeGreaterThan(1);
      expect
        .soft(new Set(navNames).size, `nav names ${route}`)
        .toBe(navNames.length);
      expect.soft(navNames, `nav names ${route}`).not.toContain('');
    }
  });

  test('content column: at most 1200px, centred like web.css (1920x1080)', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const measured: string[] = [];
    for (const route of MAIN_ROUTES) {
      await page.goto(route);
      await expect(sidebar(page)).toBeVisible();
      const block = await measureMainBlock(page);
      measured.push(
        `${route} main.box.x=${block.boxX.toFixed(2)} main.box.w=${block.boxWidth.toFixed(2)} ` +
          `content.x=${block.contentX.toFixed(2)} content.w=${block.contentWidth.toFixed(2)} main.col=${block.mainColumnWidth.toFixed(2)}`,
      );
      expect
        .soft(block.contentWidth, `content width ${route}`)
        .toBeLessThanOrEqual(SAMPLE_CONTENT_MAX);
      expect
        .soft(block.contentWidth, `content width ${route}`)
        .toBe(SAMPLE_CONTENT_MAX);
      // web.css: `margin: 0 auto` inside the main column (`--w-side` 264px).
      const centredX =
        block.sidebarWidth +
        Math.max(0, (block.mainColumnWidth - block.contentWidth) / 2);
      expect
        .soft(Math.abs(block.contentX - centredX), `centred ${route}`)
        .toBeLessThanOrEqual(1);
    }
    console.log(`M2.10a 1a :: ${measured.join(' | ')}`);
  });

  test('grids: Khám phá 4 columns and the path grid matching web/path.html', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    const measured: string[] = [];
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/learn');
      await expect(page.locator('.home-explore')).toBeVisible();
      const explore = await gridTracks(page, '.home-explore');
      measured.push(
        `${width} explore=${explore.length} [${explore.join(' ')}]`,
      );
      expect
        .soft(
          explore.length,
          `Khám phá columns at ${width} (web/home.html ${SAMPLE_HOME_COLUMNS})`,
        )
        .toBe(SAMPLE_HOME_COLUMNS);

      await page.goto('/learn/path');
      await expect(page.locator('.path-grid')).toBeVisible();
      const path = await gridTracks(page, '.path-grid');
      measured.push(`${width} path=${path.length} [${path.join(' ')}]`);
      expect
        .soft(
          path.length,
          `path columns at ${width} (web/path.html ${SAMPLE_PATH_COLUMNS})`,
        )
        .toBe(SAMPLE_PATH_COLUMNS);
    }
    console.log(`M2.10a 1b :: ${measured.join(' | ')}`);
  });

  test('no horizontal overflow at 1024, 1280 and 1920 on the framed routes', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    const measured: string[] = [];
    for (const width of [1024, 1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        await page.goto(route);
        await expect(sidebar(page)).toBeVisible();
        const layout = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        measured.push(
          `${route}@${width} scroll=${layout.scrollWidth} client=${layout.clientWidth}`,
        );
        expect
          .soft(layout.scrollWidth, `${route} at ${width}`)
          .toBeLessThanOrEqual(layout.clientWidth);
      }
    }
    console.log(`M2.10a 1c :: ${measured.join(' | ')}`);
  });

  test('200% zoom keeps the frame free of overlapping text and the focus rings', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.setViewportSize({ width: 1440, height: 900 });
    const measured: string[] = [];
    for (const route of MAIN_ROUTES) {
      await page.goto(route);
      await expect(sidebar(page)).toBeVisible();
      // 200% browser zoom as CSS zoom: the layout viewport stays 1440px, so the
      // web frame still applies while only ~720px of content fits.
      await page.evaluate(() => {
        document.documentElement.style.zoom = '2';
      });
      const boxes = await expectNoTextOverlap(page, `${route} zoom 200%`);

      await page.keyboard.press('Tab');
      const side = await activeFocusRing(page);
      expect.soft(side.inSidebar, `sidebar focus ${route}`).toBe(true);
      expect.soft(side.boxShadow, `sidebar ring ${route}`).not.toBe('none');

      await topSearch(page).focus();
      const search = await activeFocusRing(page);
      expect.soft(search.inTopbar, `search focus ${route}`).toBe(true);
      expect.soft(search.boxShadow, `search ring ${route}`).not.toBe('none');

      const layout = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      measured.push(
        `${route} boxes=${boxes} searchRing="${search.boxShadow}" ` +
          `sideRing="${side.boxShadow.slice(0, 40)}" scroll=${layout.scrollWidth}/${layout.clientWidth}`,
      );
    }
    console.log(`M2.10a 2-zoom :: ${measured.join(' | ')}`);
  });

  test('forced colours keep the frame free of overlapping text and the focus rings', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ forcedColors: 'active' });
    const measured: string[] = [];
    for (const route of MAIN_ROUTES) {
      await page.goto(route);
      await expect(sidebar(page)).toBeVisible();
      const boxes = await expectNoTextOverlap(page, `${route} forced colours`);

      await page.keyboard.press('Tab');
      const side = await activeFocusRing(page);
      expect.soft(side.inSidebar, `sidebar focus ${route}`).toBe(true);
      expect.soft(side.outlineStyle, `sidebar outline ${route}`).toBe('solid');
      expect
        .soft(Number.parseFloat(side.outlineWidth), `sidebar outline ${route}`)
        .toBeGreaterThanOrEqual(2);

      await topSearch(page).focus();
      const search = await activeFocusRing(page);
      expect.soft(search.inTopbar, `search focus ${route}`).toBe(true);
      expect.soft(search.outlineStyle, `search outline ${route}`).toBe('solid');
      expect
        .soft(Number.parseFloat(search.outlineWidth), `search outline ${route}`)
        .toBeGreaterThanOrEqual(2);

      measured.push(
        `${route} boxes=${boxes} sideOutline=${side.outlineStyle} ${side.outlineWidth} ` +
          `searchOutline=${search.outlineStyle} ${search.outlineWidth}`,
      );
    }
    console.log(`M2.10a 2-forced-colors :: ${measured.join(' | ')}`);
  });
});
