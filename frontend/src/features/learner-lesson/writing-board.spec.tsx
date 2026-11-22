import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WordStrokes } from './stroke-data';
import { toBoardPoint, type Point } from './strokes';
import { WritingBoard } from './writing-board';

// Two strokes per character: a horizontal then a vertical line (data coordinates).
const H: Point[] = [
  [200, 500],
  [800, 500],
];
const V: Point[] = [
  [500, 800],
  [500, 200],
];
const twoStrokes = (hanzi: string) => ({
  hanzi,
  strokes: [
    'M 200 450 L 800 450 L 800 550 Z',
    'M 450 800 L 550 800 L 550 200 Z',
  ],
  medians: [H, V],
});
const words = (hanzi: string): WordStrokes => ({
  characters: Array.from(hanzi).map(twoStrokes),
  sources: [
    {
      code: 'MMAH',
      attribution: 'Dữ liệu nét chữ: Make Me a Hanzi',
      referenceUrl: 'https://github.com/skishore/makemeahanzi',
    },
  ],
});

let reduced = false;
const fetchMock = vi.fn();

beforeEach(() => {
  reduced = false;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && query.includes('reduce'),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  // A 1024 px board at the page origin: client pixels equal board units.
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 1024,
    height: 1024,
  } as DOMRect);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const board = () => document.querySelector('.g-board svg') as SVGSVGElement;
const status = () => document.querySelector('.g-wstat')?.textContent;
const live = () => screen.getByRole('status').textContent ?? '';

function draw(points: Point[]) {
  const [first, ...rest] = points.map(toBoardPoint);
  if (!first) return;
  fireEvent.pointerDown(board(), {
    clientX: first[0],
    clientY: first[1],
    pointerId: 1,
  });
  for (const [x, y] of rest)
    fireEvent.pointerMove(board(), { clientX: x, clientY: y, pointerId: 1 });
  fireEvent.pointerUp(board(), { pointerId: 1 });
}
const along = (median: Point[]): Point[] => {
  const [a, b] = median as [Point, Point];
  return Array.from({ length: 9 }, (_, k) => [
    a[0] + ((b[0] - a[0]) * k) / 8,
    a[1] + ((b[1] - a[1]) * k) / 8,
  ]);
};

async function openBoard(hanzi = '十') {
  const onClose = vi.fn();
  render(
    <WritingBoard
      hanzi={hanzi}
      pinyin="shí"
      data={words(hanzi)}
      onClose={onClose}
    />,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return onClose;
}

describe('WritingBoard (G2d)', () => {
  it('plays every stroke, then writes stroke by stroke with a hint on a miss', async () => {
    await openBoard();
    expect(
      screen.getByRole('dialog', { name: 'Viết 十 shí' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Lưới chữ điền và chữ 十, 2 nét' }),
    ).toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Đóng bảng viết' }),
    );
    expect(status()).toBe('Xong 2/2 nét');

    fireEvent.click(screen.getByRole('button', { name: 'Tự viết' }));
    expect(screen.getByRole('button', { name: 'Tự viết' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(status()).toBe('Nét 1/2');
    expect(document.querySelectorAll('.g-board .hint')).toHaveLength(1);

    draw(along(V)); // the second stroke first: wrong order
    expect(status()).toBe('Nét 1/2');
    expect(document.querySelector('.g-board')).toHaveClass('is-miss');
    expect(live()).toContain('Chưa khớp, thử lại nét này');

    draw(along(H));
    expect(status()).toBe('Nét 2/2');
    expect(live()).toContain('Đúng. Nét 2');
    draw(along(V));
    expect(status()).toBe('Xong 2/2 nét');
    expect(document.querySelectorAll('.g-board .done')).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('moves to the next character of a word by itself', async () => {
    await openBoard('十十');
    fireEvent.click(screen.getByRole('button', { name: 'Tự viết' }));
    expect(status()).toBe('Chữ 1/2 · Nét 1/2');
    vi.useFakeTimers();
    draw(along(H));
    draw(along(V));
    expect(status()).toBe('Chữ 1/2 · Xong 2/2 nét');
    act(() => vi.advanceTimersByTime(700));
    expect(status()).toBe('Chữ 2/2 · Nét 1/2');
    expect(live()).toContain('Chữ 2/2');
  });

  it('Viết lại starts the character over; Ẩn mẫu hides the faint glyph', async () => {
    await openBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Tự viết' }));
    draw(along(H));
    fireEvent.click(screen.getByRole('button', { name: 'Tự viết' }));
    expect(status()).toBe('Nét 1/2');
    const ghost = screen.getByRole('button', { name: 'Ẩn mẫu' });
    fireEvent.click(ghost);
    expect(ghost).toHaveAttribute('aria-pressed', 'true');
    expect(ghost).toHaveTextContent('Hiện mẫu');
    expect(document.querySelector('.g-board')).toHaveClass('is-hidden');
  });

  it('credits the source with a safe link, or as plain text', async () => {
    await openBoard();
    const link = screen.getByRole('link', {
      name: 'Dữ liệu nét chữ: Make Me a Hanzi',
    });
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/skishore/makemeahanzi',
    );
  });

  it('shows the credit as text when there is no link', async () => {
    const data = words('十');
    data.sources = [
      { code: 'MMAH', attribution: 'Nguồn nét', referenceUrl: null },
    ];
    render(
      <WritingBoard hanzi="十" pinyin={null} data={data} onClose={vi.fn()} />,
    );
    expect(screen.getByText('Nguồn nét').tagName).toBe('P');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('with reduced motion the strokes appear without animation', async () => {
    reduced = true;
    const animate = vi.fn();
    Object.defineProperty(SVGElement.prototype, 'animate', {
      value: animate,
      configurable: true,
    });
    await openBoard();
    expect(status()).toBe('Xong 2/2 nét');
    expect(animate).not.toHaveBeenCalled();
    Reflect.deleteProperty(SVGElement.prototype, 'animate');
  });

  it('Esc and the close button close it', async () => {
    const onClose = await openBoard();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    // After drawing, focus is on the page body, outside the dialog.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Đóng bảng viết' }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
