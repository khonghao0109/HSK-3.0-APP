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
    expect((tile as HTMLElement).style.getPropertyValue('--hz-len')).toBe('2');
    expect(container.querySelector('.topic-word__hz')).toBeNull();
    expect(container.querySelector('.topic-word__img')).toBeNull();
    expect(screen.getByText('wǒmen')).toBeDefined();
    expect(
      screen.getByRole('link', { name: /我们\s*wǒmen\s*chúng tôi/ }),
    ).toBeDefined();
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
