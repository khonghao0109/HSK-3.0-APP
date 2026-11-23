import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./lesson-image', () => ({
  LessonImage: ({ altText }: { altText: string | null }) => (
    <span role="img" aria-label={altText ?? ''} className="topic-word__img" />
  ),
}));

import { WordList } from './lesson-topics-view';

const word = (
  id: number,
  hanzi: string,
  pinyinTone: string,
  vi: string,
  image: { id: number; altText: string | null } | null = null,
) => ({
  id,
  topicId: null,
  hanzi,
  pinyin: pinyinTone,
  pinyinTone,
  meanings: [{ vi, en: null }],
  image,
});

describe('WordList (Q354, Q355)', () => {
  it('gives a word without an image a square tile with the word in large type', () => {
    const { container } = render(
      <WordList words={[word(1, '我们', 'wo3 men5', 'chúng tôi')]} />,
    );
    const tile = container.querySelector('.topic-word__tile');
    expect(tile?.textContent).toBe('我们');
    expect(tile?.getAttribute('lang')).toBe('zh-Hans');
    // G3c: length drives the tile font-size via a data attribute, not an inline
    // style (CSP forbids the `style` attribute without 'unsafe-inline').
    expect(tile?.getAttribute('data-hz-len')).toBe('2');
    expect(tile?.getAttribute('style')).toBeNull();
    expect(container.querySelector('.topic-word__hz')).toBeNull();
    expect(container.querySelector('.topic-word__img')).toBeNull();
    expect(screen.getByText('wǒmen')).toBeDefined();
    expect(
      screen.getByRole('link', { name: /我们\s*wǒmen\s*chúng tôi/ }),
    ).toBeDefined();
  });

  it('caps data-hz-len at 4 and never sets an inline style (G3c, CSP)', () => {
    const { container } = render(
      <WordList
        words={[
          word(1, '好', 'hao3', 'tốt'),
          word(2, '一二三四五', 'yi1 er4 san1 si4 wu3', 'năm chữ'),
        ]}
      />,
    );
    const tiles = container.querySelectorAll('.topic-word__tile');
    expect(tiles[0]?.getAttribute('data-hz-len')).toBe('1');
    expect(tiles[1]?.getAttribute('data-hz-len')).toBe('4');
    tiles.forEach((tile) => expect(tile.getAttribute('style')).toBeNull());
  });

  it('shows the image, then the word, for a word with an image', () => {
    const { container } = render(
      <WordList
        words={[
          word(2, '老师', 'lao3 shi1', 'giáo viên', {
            id: 9,
            altText: 'Cô giáo đứng cạnh bảng',
          }),
        ]}
      />,
    );
    expect(
      screen.getByRole('img', { name: 'Cô giáo đứng cạnh bảng' }),
    ).toBeDefined();
    expect(container.querySelector('.topic-word__tile')).toBeNull();
    expect(container.querySelector('.topic-word__hz')?.textContent).toBe(
      '老师',
    );
    expect(screen.getByText('lǎoshī')).toBeDefined();
  });
});
