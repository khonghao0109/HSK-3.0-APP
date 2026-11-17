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

describe('lượt 8 detail rules', () => {
  it('draws the 田字格 grid only behind the four large-Hanzi spots', () => {
    const allowed = [
      '.learner-app .fc-hz::before',
      '.learner-app .word__hz::before',
      '.learner-app .dict-item--top .dict-item__hz::before',
      '.learner-app .word-web__hero .word__head::before',
    ];
    const uses = [...declarations(css), ...declarations(webCss)].filter(
      ({ decl }) => decl.includes('var(--tzg-mask)'),
    );
    expect(uses.length).toBeGreaterThan(0);
    for (const { selector } of uses)
      for (const part of selector.split(','))
        expect(allowed).toContain(part.trim());
  });
});
