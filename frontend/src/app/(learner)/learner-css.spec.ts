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
