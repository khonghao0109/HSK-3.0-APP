import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HanziCells } from './hanzi-cells';

function cells(text: string) {
  const { container } = render(
    <p>
      <HanziCells text={text} />
    </p>,
  );
  const p = container.querySelector('p')!;
  return {
    p,
    cells: [...p.querySelectorAll('.tzg-cell')].map((c) => c.textContent),
  };
}

describe('HanziCells', () => {
  it.each([
    ['学', ['学']],
    ['学习', ['学', '习']],
    ['截图词典', ['截', '图', '词', '典']],
  ])('one cell per Han character: %s', (text, expected) => {
    const r = cells(text);
    expect(r.cells).toEqual(expected);
    expect(r.p.textContent).toBe(text);
  });

  it('keeps Latin, spaces and dots out of the cells, text unchanged', () => {
    const r = cells('A 学·习');
    expect(r.cells).toEqual(['学', '习']);
    expect(r.p.textContent).toBe('A 学·习');
  });

  it('does not split a character outside the BMP', () => {
    const r = cells('𠀀学');
    expect(r.cells).toEqual(['𠀀', '学']);
  });
});
