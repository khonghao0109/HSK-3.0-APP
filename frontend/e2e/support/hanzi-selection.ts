import type { Locator } from '@playwright/test';

/**
 * What a user copies from a HanziCells word: drag across it, then
 * triple-click a cell. Each must give the word once (not empty, not doubled
 * by the .sr-only copy). A triple-click selects the whole block, so the
 * browser adds its usual trailing line break; that is trimmed.
 */
export async function copiedHanzi(word: Locator) {
  const page = word.page();
  const box = (await word.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, y, { steps: 10 });
  await page.mouse.up();
  const drag = await page.evaluate(() => getSelection()?.toString() ?? '');
  await word.locator('.tzg-cell').first().click({ clickCount: 3 });
  const triple = await page.evaluate(
    () => getSelection()?.toString().trimEnd() ?? '',
  );
  await page.evaluate(() => getSelection()?.removeAllRanges());
  return { drag, triple };
}
