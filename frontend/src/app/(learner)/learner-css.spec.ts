import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/app/(learner)/learner.css'),
  'utf8',
);

describe('learner.css percent classes', () => {
  it('defines .pct-0 … .pct-100, each setting --value to its own percent', () => {
    const rules = [
      ...css.matchAll(/\.learner-app \.pct-(\d+) \{\s*--value: (\d+)%;\s*\}/gu),
    ].map((match) => [Number(match[1]), Number(match[2])]);
    expect(rules).toEqual(
      Array.from({ length: 101 }, (_, index) => [index, index]),
    );
  });
});

/** Every declaration with the selector and enclosing @-rules it sits in. */
function declarations(source: string) {
  const out: { decl: string; selector: string; atRules: string[] }[] = [];
  const stack: string[] = [];
  let buffer = '';
  for (const char of source.replace(/\/\*[\s\S]*?\*\//gu, '')) {
    if (char === '{') {
      stack.push(buffer.trim());
      buffer = '';
    } else if (char === ';' || char === '}') {
      const decl = buffer.trim();
      const selector = stack.at(-1) ?? '';
      if (decl)
        out.push({
          decl,
          selector,
          atRules: stack.filter((s) => s.startsWith('@')),
        });
      buffer = '';
      if (char === '}') stack.pop();
    } else buffer += char;
  }
  return out;
}

const webCss = readFileSync(
  resolve(process.cwd(), 'src/app/(learner)/learner-web.css'),
  'utf8',
);

describe('lượt 8–9 detail rules', () => {
  it('draws the 田字格 grid only in the per-character cells of the three large-Hanzi spots', () => {
    const allowed =
      '.learner-app :is(.fc-hz, .word__hz, .dict-item--top .dict-item__hz) .tzg-cell::before';
    const uses = [...declarations(css), ...declarations(webCss)].filter(
      ({ decl }) => decl.includes('var(--tzg-mask)'),
    );
    expect(uses.length).toBeGreaterThan(0);
    for (const { selector } of uses)
      expect(selector.replace(/\s+/gu, ' ')).toBe(allowed);
  });

  it('keeps every 田字格 cell 1:1 and scoped to the three spots', () => {
    const cellRules = [...declarations(css), ...declarations(webCss)].filter(
      ({ selector }) => selector.includes('.tzg-cell'),
    );
    expect(cellRules.length).toBeGreaterThan(0);
    for (const { selector } of cellRules)
      expect(selector.replace(/\s+/gu, ' ')).toMatch(
        /^\.learner-app (:is\(\.fc-hz, \.word__hz, \.dict-item--top \.dict-item__hz\)|\.word-web__hero \.word__(hz|head))/u,
      );
    const cell = declarations(webCss)
      .filter(
        ({ selector }) =>
          selector.replace(/\s+/gu, ' ') ===
          '.learner-app :is(.fc-hz, .word__hz, .dict-item--top .dict-item__hz) .tzg-cell',
      )
      .map(({ decl }) => decl);
    expect(cell).toEqual(
      expect.arrayContaining([
        'inline-size: 1.25em',
        'block-size: 1.25em',
        'aspect-ratio: 1',
      ]),
    );
    // Hero cells stay one row in reading order: no 2×2 grid.
    expect(
      declarations(webCss).filter(
        ({ selector, decl }) =>
          selector.includes('.word-web__hero .word__hz') &&
          decl.startsWith('grid-template-columns'),
      ),
    ).toEqual([]);
  });
});
