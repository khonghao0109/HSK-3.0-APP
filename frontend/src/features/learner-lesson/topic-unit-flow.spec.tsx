import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DialogueBlock, GrammarPointBlock } from './topic-content';
import { GrammarUnitFlow, KeyTextUnitFlow } from './topic-unit-flow';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const point = (title: string, zh: string): GrammarPointBlock => ({
  kind: 'grammar_point',
  title,
  formula: [
    { role: 'subj', zh: '主语', vi: 'Chủ ngữ' },
    { role: 'key', zh, vi: 'Từ khoá' },
  ],
  explanation: `Dùng ${zh} để hỏi.`,
  examples: [
    {
      hanzi: `你家有${zh}口人？`,
      pinyin: 'Nǐ jiā',
      vi: 'Nhà bạn',
      highlight: zh,
    },
  ],
});

const common = {
  lessonId: 5,
  topicId: 9,
  title: 'Ngữ pháp · Gia đình',
  lessonHref: '/learn/lessons/5',
  nextHref: '/learn/lessons/5/grammar?unit=10',
};

describe('GrammarUnitFlow', () => {
  const show = () =>
    render(
      <GrammarUnitFlow
        {...common}
        points={[point('Hỏi với 几', '几'), point('Câu với 是', '是')]}
      />,
    );

  it('shows one card per grammar point, Điểm n trên N', () => {
    show();
    expect(screen.getByText('Điểm 1 trên 2')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Hỏi với 几' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Công thức' })).toBeInTheDocument();
    // One bar per breakpoint (m-only / w-only), as in Pha C.
    for (const bar of screen.getAllByRole('progressbar', {
      name: 'Tiến độ đơn vị',
    })) {
      expect(bar).toHaveAttribute('aria-valuenow', '1');
    }
    expect(screen.getByRole('link', { name: 'Về bài' })).toHaveAttribute(
      'href',
      '/learn/lessons/5',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the Đã hiểu switch local: it does not block or save', () => {
    show();
    const toggle = screen.getByRole('checkbox', { name: 'Đã hiểu Hỏi với 几' });
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Đã hiểu' }));
    // The next card starts unchecked.
    expect(
      screen.getByRole('checkbox', { name: 'Đã hiểu Câu với 是' }),
    ).not.toBeChecked();
  });

  it('Đã hiểu goes to the next card, then to the result that marks it done', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Đã hiểu' }));
    expect(screen.getByText('Điểm 2 trên 2')).toBeInTheDocument();
    const heading = screen.getByRole('heading', {
      level: 2,
      name: 'Câu với 是',
    });
    expect(document.activeElement).toBe(heading);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Đã hiểu' }));
    });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Ngữ pháp · Gia đình',
    );
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/learner/lessons/5/start',
      '/api/learner/topics/9/complete',
    ]);
  });
});

describe('KeyTextUnitFlow', () => {
  const dialogue: DialogueBlock = {
    kind: 'dialogue',
    lines: [
      { speaker: 'An', hanzi: '你好！', pinyin: 'Nǐ hǎo!', vi: 'Chào bạn!' },
      { speaker: 'Bình', hanzi: '你好！', pinyin: 'Nǐ hǎo!', vi: 'Chào An!' },
    ],
  };
  const show = () =>
    render(
      <KeyTextUnitFlow
        {...common}
        title="Bài khoá · Gia đình"
        heading="Nhà bạn có mấy người?"
        description="Đọc hội thoại giữa An và Bình."
        dialogues={[dialogue]}
      />,
    );

  it('shows the conversation, one row per turn', () => {
    show();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Nhà bạn có mấy người?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Đọc hội thoại giữa An và Bình.'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('img', { name: 'Bình' }).textContent).toBe('B');
    // mẫu: no pinyin toggle.
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('Hoàn thành opens the result that marks the unit done', async () => {
    show();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành' }));
    });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Bài khoá · Gia đình',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
