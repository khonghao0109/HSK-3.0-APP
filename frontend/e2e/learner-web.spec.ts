import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  request as playwrightRequest,
  test,
  type Locator,
  type Page,
} from '@playwright/test';

import { queryDisposableDb, sqlLiteral } from './support/disposable-db';
import {
  backendLogin,
  call,
  LISTENING_PROMPT,
  publishLockedLesson,
  publishPracticeExercises,
  readyLessonId,
  registerReadyLearner,
  PASSWORD,
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

    // M2.10b: the lesson detail screens joined the frame (the sidebar marks
    // "Lộ trình học" current); the player screens use `.w-focus` instead.
    await page.goto(`/learn/lessons/${lessonId}`);
    await expect(page.locator('.lesson-hero').first()).toBeVisible();
    await expect(sidebar(page)).toBeVisible();
    await expect(
      mainNav(page).getByRole('link', { name: 'Lộ trình học' }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.tabbar')).toBeHidden();
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

/* ------------------------------------------------------------------ */
/* M2.10b: Tra từ, Chi tiết từ and Bài học in `.w-app`; Luyện tập and
   Hoàn thành in `.w-focus` (web/dictionary.html, word.html, lesson.html,
   lesson-not-found.html, practice-*.html, lesson-complete.html). */

/** web/css/web.css `.w-focus__body`: 760px content plus 2 × 40px gutters. */
const SAMPLE_FOCUS_BODY = 840;
const SAMPLE_FOCUS_CONTENT = 760;

type FocusMeasure = {
  bodyX: number;
  bodyWidth: number;
  contentWidth: number;
  footInnerX: number | null;
  footInnerWidth: number | null;
};

/** The `.w-focus` body box and its painted content width. */
async function measureFocusBody(page: Page): Promise<FocusMeasure> {
  return page.evaluate(() => {
    const body = document.querySelector<HTMLElement>('.ex-body, .done-main');
    if (!body) throw new Error('focus body is missing');
    const rect = body.getBoundingClientRect();
    let maxX = Number.NEGATIVE_INFINITY;
    let minX = Number.POSITIVE_INFINITY;
    for (const element of Array.from(body.querySelectorAll('*'))) {
      if (!(element instanceof HTMLElement) || !element.checkVisibility()) {
        continue;
      }
      if (element.closest('.sr-only')) continue;
      const box = element.getBoundingClientRect();
      if (box.width < 4 || box.height < 4) continue;
      minX = Math.min(minX, box.x);
      maxX = Math.max(maxX, box.x + box.width);
    }
    const footInner = document.querySelector<HTMLElement>(
      '.ex-foot > div, .done-actions',
    );
    const footRect = footInner?.getBoundingClientRect();
    return {
      bodyX: rect.x,
      bodyWidth: rect.width,
      contentWidth: maxX - minX,
      footInnerX: footRect ? footRect.x : null,
      footInnerWidth: footRect ? footRect.width : null,
    };
  });
}

type WebFixture = {
  hsk1Lesson: number;
  hsk3Lesson: number;
  lockedLesson: number;
  wordId: number;
};

/** Idempotent write against the backend with a fresh Idempotency-Key. */
async function learnerWrite(
  api: Awaited<ReturnType<typeof playwrightRequest.newContext>>,
  token: string,
  route: string,
  data: unknown,
): Promise<void> {
  const response = await api.fetch(`http://127.0.0.1:3100/api/v1${route}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'idempotency-key': `m210b-web-${crypto.randomUUID()}`,
    },
    data,
  });
  if (!response.ok()) {
    throw new Error(`POST ${route} → ${response.status()}`);
  }
}

type PlayerExercise = { id: number; type: string };

async function playerActivity(
  api: Awaited<ReturnType<typeof playwrightRequest.newContext>>,
  token: string,
  lessonId: number,
): Promise<PlayerExercise[]> {
  const activity = await call<{
    topics: Array<{ exercises: PlayerExercise[] }>;
    standaloneExercises: PlayerExercise[];
  }>(api, 'GET', `/learning/lessons/${lessonId}/activity`, token);
  return [
    ...activity.topics.flatMap((topic) => topic.exercises),
    ...activity.standaloneExercises,
  ];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The known right answers of the publishPracticeExercises fixtures. */
async function answerFixture(
  api: Awaited<ReturnType<typeof playwrightRequest.newContext>>,
  token: string,
  exercise: PlayerExercise,
): Promise<void> {
  // The backend allows at most 1 attempt per second per learner.
  await sleep(1100);
  const answer =
    exercise.type === 'arrange_sentence'
      ? { tokenIds: ['wo', 'xiang', 'mai'] }
      : exercise.type === 'fill_blank'
        ? { text: '买' }
        : { optionId: 'market' };
  await learnerWrite(
    api,
    token,
    `/learning/exercises/${exercise.id}/attempts`,
    {
      answer,
    },
  );
}

/** Starts the lesson and answers arrange + fill, leaving listening pending. */
async function reachListening(email: string, lessonId: number): Promise<void> {
  const api = await playwrightRequest.newContext();
  try {
    const token = await backendLogin(api, email, PASSWORD);
    await learnerWrite(api, token, `/learning/lessons/${lessonId}/start`, {});
    const exercises = await playerActivity(api, token, lessonId);
    const byType = new Map(
      exercises.map((exercise) => [exercise.type, exercise]),
    );
    const arrange = byType.get('arrange_sentence');
    const fill = byType.get('fill_blank');
    if (!arrange || !fill) throw new Error('fixture exercises are missing');
    await answerFixture(api, token, arrange);
    await answerFixture(api, token, fill);
  } finally {
    await api.dispose();
  }
}

/** Finishes every fixture exercise and the lesson itself (Q58 order). */
async function finishLesson(email: string, lessonId: number): Promise<void> {
  const api = await playwrightRequest.newContext();
  try {
    const token = await backendLogin(api, email, PASSWORD);
    await learnerWrite(api, token, `/learning/lessons/${lessonId}/start`, {});
    const exercises = await playerActivity(api, token, lessonId);
    for (const exercise of exercises) await answerFixture(api, token, exercise);
    const activity = await call<{
      topics: Array<{ id: number }>;
    }>(api, 'GET', `/learning/lessons/${lessonId}/activity`, token);
    for (const topic of activity.topics) {
      await sleep(1100);
      await learnerWrite(api, token, `/learning/topics/${topic.id}/start`, {});
      await sleep(1100);
      await learnerWrite(
        api,
        token,
        `/learning/topics/${topic.id}/complete`,
        {},
      );
    }
    await learnerWrite(
      api,
      token,
      `/learning/lessons/${lessonId}/complete`,
      {},
    );
  } finally {
    await api.dispose();
  }
}

test.describe('Learner web content (M2.10b) @web', () => {
  const fixture: WebFixture = {
    hsk1Lesson: 0,
    hsk3Lesson: 0,
    lockedLesson: 0,
    wordId: 0,
  };

  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(async () => {
    const hsk1 = await readyLessonId('HSK1');
    if (!hsk1) throw new Error('seed has no ready HSK1 lesson');
    fixture.hsk1Lesson = hsk1;
    fixture.hsk3Lesson = await publishPracticeExercises();
    fixture.lockedLesson = await publishLockedLesson();
    fixture.wordId = wordId();
  });

  test('frames follow the mockup table: .w-app vs .w-focus, aria-current', async ({
    page,
    baseURL,
  }) => {
    const email = await registerReadyLearner(page, baseURL);
    const appRoutes: Array<[string, string]> = [
      ['/learn/dictionary', 'Tra từ'],
      [`/learn/dictionary/${fixture.wordId}`, 'Tra từ'],
      ['/learn/dictionary/99999999', 'Tra từ'],
      [`/learn/lessons/${fixture.hsk1Lesson}`, 'Lộ trình học'],
      [`/learn/lessons/${fixture.lockedLesson}`, 'Lộ trình học'],
      ['/learn/lessons/99999999', 'Lộ trình học'],
    ];
    for (const [route, current] of appRoutes) {
      await page.goto(route);
      await expect(sidebar(page), `sidebar ${route}`).toBeVisible();
      await expect(page.locator('.w-top'), `top bar ${route}`).toBeVisible();
      await expect(page.locator('.tabbar'), `tab bar ${route}`).toBeHidden();
      await expect(
        mainNav(page).getByRole('link', { name: current, exact: true }),
        `aria-current ${route}`,
      ).toHaveAttribute('aria-current', 'page');
    }

    await page.goto(`/learn/lessons/${fixture.hsk1Lesson}/practice`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Luyện tập' }),
    ).toBeVisible();
    await expect(sidebar(page), 'sidebar practice').toHaveCount(0);
    await expect(page.locator('.w-top'), 'top bar practice').toHaveCount(0);
    await expect(page.locator('.tabbar'), 'tab bar practice').toBeHidden();

    await finishLesson(email, fixture.hsk3Lesson);
    await page.goto(`/learn/lessons/${fixture.hsk3Lesson}/complete`);
    await expect(page.locator('.done-title')).toBeVisible();
    await expect(sidebar(page), 'sidebar complete').toHaveCount(0);
    await expect(page.locator('.w-top'), 'top bar complete').toHaveCount(0);
    await expect(page.locator('.tabbar'), 'tab bar complete').toBeHidden();
    console.log('M2.10b 1 :: frames verified for 6 .w-app + 2 .w-focus routes');
  });

  test('content columns: .w-app 1200px at 1920; .w-focus 760px at 1440 and 1920', async ({
    page,
    baseURL,
  }) => {
    const email = await registerReadyLearner(page, baseURL);
    const measured: string[] = [];
    await page.setViewportSize({ width: 1920, height: 1080 });
    for (const route of [
      '/learn/dictionary',
      `/learn/dictionary/${fixture.wordId}`,
      `/learn/lessons/${fixture.hsk1Lesson}`,
    ]) {
      await page.goto(route);
      await expect(sidebar(page)).toBeVisible();
      const block = await measureMainBlock(page);
      measured.push(
        `${route} content.x=${block.contentX.toFixed(2)} content.w=${block.contentWidth.toFixed(2)}`,
      );
      expect
        .soft(block.contentWidth, `content width ${route}`)
        .toBeLessThanOrEqual(SAMPLE_CONTENT_MAX);
      const centredX =
        block.sidebarWidth +
        Math.max(0, (block.mainColumnWidth - block.contentWidth) / 2);
      expect
        .soft(Math.abs(block.contentX - centredX), `centred ${route}`)
        .toBeLessThanOrEqual(1);
    }

    // `.w-focus`: sample measures body 840px wide (x=300 at 1440, x=540 at
    // 1920) with the footer content 760px wide (x=340/580).
    await page.goto(`/learn/lessons/${fixture.hsk1Lesson}/practice`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Luyện tập' }),
    ).toBeVisible();
    for (const width of [1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(150);
      const focus = await measureFocusBody(page);
      measured.push(
        `practice@${width} body.x=${focus.bodyX.toFixed(2)} body.w=${focus.bodyWidth.toFixed(2)} ` +
          `content.w=${focus.contentWidth.toFixed(2)} foot.w=${focus.footInnerWidth?.toFixed(2) ?? 'none'}`,
      );
      expect
        .soft(focus.bodyWidth, `focus body ${width}`)
        .toBeLessThanOrEqual(SAMPLE_FOCUS_BODY);
      expect
        .soft(focus.bodyWidth, `focus body ${width}`)
        .toBe(SAMPLE_FOCUS_BODY);
      expect
        .soft(
          Math.abs(focus.bodyX - (width - focus.bodyWidth) / 2),
          `focus centred ${width}`,
        )
        .toBeLessThanOrEqual(1);
      expect
        .soft(focus.contentWidth, `focus content ${width}`)
        .toBeLessThanOrEqual(SAMPLE_FOCUS_CONTENT);
      expect
        .soft(focus.footInnerWidth ?? 0, `focus foot ${width}`)
        .toBeLessThanOrEqual(SAMPLE_FOCUS_CONTENT);
    }

    await finishLesson(email, fixture.hsk3Lesson);
    for (const width of [1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/learn/lessons/${fixture.hsk3Lesson}/complete`);
      await expect(page.locator('.done-title')).toBeVisible();
      const focus = await measureFocusBody(page);
      measured.push(
        `complete@${width} body.x=${focus.bodyX.toFixed(2)} body.w=${focus.bodyWidth.toFixed(2)} ` +
          `content.w=${focus.contentWidth.toFixed(2)}`,
      );
      expect
        .soft(focus.contentWidth, `complete content ${width}`)
        .toBeLessThanOrEqual(SAMPLE_FOCUS_CONTENT);
      expect
        .soft(
          Math.abs(
            focus.bodyX +
              (focus.bodyWidth - focus.contentWidth) / 2 -
              (width - focus.contentWidth) / 2,
          ),
          `complete centred ${width}`,
        )
        .toBeLessThanOrEqual(1);
    }
    console.log(`M2.10b 2 :: ${measured.join(' | ')}`);
  });

  test('no horizontal overflow on the M2.10b routes at 1024, 1280 and 1920', async ({
    page,
    baseURL,
  }) => {
    const email = await registerReadyLearner(page, baseURL);
    const m210bRoutes = [
      '/learn/dictionary',
      `/learn/dictionary/${fixture.wordId}`,
      '/learn/dictionary/99999999',
      `/learn/lessons/${fixture.hsk1Lesson}`,
      `/learn/lessons/${fixture.lockedLesson}`,
      '/learn/lessons/99999999',
      `/learn/lessons/${fixture.hsk1Lesson}/practice`,
    ];
    const measured: string[] = [];
    for (const width of [1024, 1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of m210bRoutes) {
        await page.goto(route);
        const layout = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        measured.push(
          `${route}@${width} ${layout.scrollWidth}/${layout.clientWidth}`,
        );
        expect
          .soft(layout.scrollWidth, `${route} at ${width}`)
          .toBeLessThanOrEqual(layout.clientWidth);
      }
    }
    // Complete is a .w-focus route too.
    await finishLesson(email, fixture.hsk3Lesson);
    for (const width of [1024, 1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/learn/lessons/${fixture.hsk3Lesson}/complete`);
      const layout = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      measured.push(
        `complete@${width} ${layout.scrollWidth}/${layout.clientWidth}`,
      );
      expect
        .soft(layout.scrollWidth, `complete at ${width}`)
        .toBeLessThanOrEqual(layout.clientWidth);
    }
    console.log(`M2.10b 3 :: ${measured.join(' | ')}`);
  });

  test('Tra từ: aside right at 1280+, below in two columns under 1280 (TL-3)', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    const measured: string[] = [];
    for (const width of [1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/learn/dictionary?q=%E6%B5%8B%E8%AF%95');
      await expect(page.locator('.dict-item').first()).toBeVisible();
      const geo = await page.evaluate(() => {
        const rect = (el: Element | null) => {
          if (!el) return null;
          const box = el.getBoundingClientRect();
          return {
            x: box.x,
            y: box.y,
            right: box.right,
            bottom: box.bottom,
            width: box.width,
          };
        };
        const grid = document.querySelector('.dict-web');
        const main = document.querySelector('.dict-web__main');
        const aside = document.querySelector('.dict-web__aside');
        return {
          gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns : '',
          main: rect(main),
          aside: rect(aside),
          asideColumns: aside
            ? getComputedStyle(aside).gridTemplateColumns
            : '',
        };
      });
      measured.push(
        `@${width} main.x=${geo.main?.x.toFixed(1)} aside.x=${geo.aside?.x.toFixed(1)} aside.y=${geo.aside?.y.toFixed(1)} cols="${geo.gridColumns}" asideCols="${geo.asideColumns}"`,
      );
      if (!geo.main || !geo.aside) {
        throw new Error('dictionary web grid is missing');
      }
      if (width >= 1280) {
        expect
          .soft(geo.aside.x, `aside right at ${width}`)
          .toBeGreaterThanOrEqual(geo.main.right - 1);
        expect
          .soft(Math.abs(geo.aside.y - geo.main.y), `aside top at ${width}`)
          .toBeLessThanOrEqual(1);
      } else {
        expect
          .soft(geo.aside.y, `aside below at ${width}`)
          .toBeGreaterThanOrEqual(geo.main.bottom - 1);
        expect
          .soft(
            geo.asideColumns.split(/\s+/u).filter(Boolean).length,
            `aside columns at ${width}`,
          )
          .toBe(2);
      }
    }
    console.log(`M2.10b 4 :: ${measured.join(' | ')}`);
  });

  test('axe WCAG 2.1 AA on the M2.10b routes', async ({ page, baseURL }) => {
    const email = await registerReadyLearner(page, baseURL);
    await finishLesson(email, fixture.hsk3Lesson);
    const m210bAxeRoutes = [
      '/learn/dictionary?q=%E6%B5%8B%E8%AF%95',
      `/learn/dictionary/${fixture.wordId}`,
      '/learn/dictionary/99999999',
      `/learn/lessons/${fixture.hsk1Lesson}`,
      `/learn/lessons/${fixture.lockedLesson}`,
      '/learn/lessons/99999999',
      `/learn/lessons/${fixture.hsk3Lesson}/complete`,
    ];
    for (const route of m210bAxeRoutes) {
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
    console.log(`M2.10b 5a :: axe clean on ${m210bAxeRoutes.length} routes`);
  });

  test('axe on the player states: mcq right, mcq wrong, listening, submit failure', async ({
    page,
    baseURL,
  }) => {
    await registerReadyLearner(page, baseURL);
    const axe = async (label: string) => {
      const { violations } = await new AxeBuilder({ page })
        .withTags(AXE_TAGS)
        .analyze();
      expect
        .soft(
          violations.map(
            (v) =>
              `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
          ),
          `axe ${label}`,
        )
        .toEqual([]);
    };

    // mcq, answered right.
    await page.goto(`/learn/lessons/${fixture.hsk1Lesson}/practice`);
    const group = page.getByRole('radiogroup');
    await group.getByRole('radio').first().click();
    await page.getByRole('button', { name: 'Kiểm tra' }).click();
    await expect(page.locator('.m02-feedback')).toBeVisible();
    await axe('mcq answered');

    // listening question (arrange + fill answered via the API first).
    const email = await registerReadyLearner(page, baseURL);
    await reachListening(email, fixture.hsk3Lesson);
    await page.goto(`/learn/lessons/${fixture.hsk3Lesson}/practice`);
    await expect(
      page.getByRole('heading', { level: 2, name: LISTENING_PROMPT }),
    ).toBeVisible();
    await axe('listening');

    // mcq answered wrong (fresh learner so the mcq is unanswered).
    await registerReadyLearner(page, baseURL);
    await page.goto(`/learn/lessons/${fixture.hsk1Lesson}/practice`);
    const group2 = page.getByRole('radiogroup');
    await group2.getByRole('radio').last().click();
    await page.getByRole('button', { name: 'Kiểm tra' }).click();
    await expect(page.locator('.m02-feedback--wrong')).toBeVisible();
    await axe('mcq wrong');

    // Submit failure (503): the alert shows and axe stays clean.
    await registerReadyLearner(page, baseURL);
    await page.route('**/api/learner/exercises/*/attempts', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: 'diag 503' },
        }),
      }),
    );
    await page.goto(`/learn/lessons/${fixture.hsk1Lesson}/practice`);
    await page.getByRole('radiogroup').getByRole('radio').first().click();
    await page.getByRole('button', { name: 'Kiểm tra' }).click();
    await expect(page.locator('.ex-error[role="alert"]')).toBeVisible();
    await axe('submit 503');
    console.log('M2.10b 5b :: axe clean on 4 player states');
  });
});

// M2.10b (review fix): `.w-only` is now the last rule of learner.css, so no
// mobile rule that sets `display` on the same element (`.icon-btn`,
// `.progress`, …) can win over it below 1024px. This guards every web-only
// part of the lesson, word and practice flows at 390px.
async function expectWOnlyHidden(page: Page, label: string): Promise<void> {
  const total = await page.locator('.w-only').count();
  expect(total, `${label}: .w-only parts rendered`).toBeGreaterThan(0);
  const visible = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.w-only'))
      .filter((element) => window.getComputedStyle(element).display !== 'none')
      .map(
        (element) => `${element.tagName.toLowerCase()}.${element.className}`,
      ),
  );
  expect(visible, `${label}: .w-only visible at 390px`).toEqual([]);
}

test.describe('Learner mobile: .w-only parts are hidden below 1024px', () => {
  test.describe.configure({ timeout: 120_000 });

  let lessonId = 0;
  let listeningLesson = 0;

  test.beforeAll(async () => {
    const hsk1 = await readyLessonId('HSK1');
    if (!hsk1) throw new Error('seed has no ready HSK1 lesson');
    lessonId = hsk1;
    listeningLesson = await publishPracticeExercises();
  });

  test('lesson, word and practice hide every .w-only part at 390px', async ({
    page,
    baseURL,
  }) => {
    const email = await registerReadyLearner(page, baseURL);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto(`/learn/lessons/${lessonId}`);
    await expect(page.locator('.lesson-hero__title')).toBeVisible();
    await expectWOnlyHidden(page, 'lesson');

    await page.goto(`/learn/dictionary/${wordId()}`);
    await expect(page.locator('.word__hz')).toBeVisible();
    await expectWOnlyHidden(page, 'word');

    await page.goto(`/learn/lessons/${lessonId}/practice`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Luyện tập' }),
    ).toBeVisible();
    await expectWOnlyHidden(page, 'practice-mcq');

    await reachListening(email, listeningLesson);
    await page.goto(`/learn/lessons/${listeningLesson}/practice`);
    await expect(
      page.getByRole('heading', { level: 2, name: LISTENING_PROMPT }),
    ).toBeVisible();
    await expectWOnlyHidden(page, 'practice-listening');
    console.log('M2.10b 6 :: .w-only hidden at 390px on 4 states');
  });
});
