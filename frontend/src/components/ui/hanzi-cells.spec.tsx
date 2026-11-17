import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HanziCells } from './hanzi-cells';

function cells(text: string) {
  const { container } = render(
    <h1>
      <HanziCells text={text} />
    </h1>,
  );
  const h1 = container.querySelector('h1')!;
  const row = h1.querySelector('.tzg-cells')!;
  return {
    h1,
    row,
    cells: [...row.querySelectorAll('.tzg-cell')].map((c) => c.textContent),
  };
}

describe('HanziCells', () => {
  it.each([
    ['学', ['学']],
    ['学习', ['学', '习']],
    ['截图词典', ['截', '图', '词', '典']],
  ])('one cell per Han character, read as one word: %s', (text, expected) => {
    const r = cells(text);
    expect(r.cells).toEqual(expected);
    expect(r.row.textContent).toBe(text);
    // The heading's accessible name is the whole word, not "学 习".
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName(
      text,
    );
    expect(screen.getByRole('heading', { name: text })).toBe(r.h1);
  });

  it('hides the cells from the accessibility tree', () => {
    const r = cells('学习');
    expect(r.row.getAttribute('aria-hidden')).toBe('true');
    expect(r.h1.querySelector('.sr-only')?.textContent).toBe('学习');
  });

  it('keeps Latin, spaces and dots out of the cells, text unchanged', () => {
    const r = cells('A 学·习');
    expect(r.cells).toEqual(['学', '习']);
    expect(r.row.textContent).toBe('A 学·习');
  });

  it('does not split a character outside the BMP', () => {
    const r = cells('𠀀学');
    expect(r.cells).toEqual(['𠀀', '学']);
  });
});
