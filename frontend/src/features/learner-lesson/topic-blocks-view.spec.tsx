import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { DialogueBlock, GrammarPointBlock } from './topic-content';
import {
  DialogueLines,
  dialogueNumbers,
  GrammarPointBody,
} from './topic-blocks-view';

const card: GrammarPointBlock = {
  kind: 'grammar_point',
  title: 'Hỏi số lượng với 几',
  formula: [
    { role: 'subj', zh: '主语', vi: 'Chủ ngữ' },
    { role: 'key', zh: '几', vi: 'Từ hỏi' },
    { role: 'other', zh: '名词', vi: 'Danh từ' },
  ],
  explanation: 'Dùng 几 để hỏi số lượng nhỏ.',
  examples: [
    {
      hanzi: '你家有几口人？',
      pinyin: 'Nǐ jiā yǒu jǐ kǒu rén?',
      vi: 'Nhà bạn có mấy người?',
      highlight: '几',
    },
  ],
};

describe('GrammarPointBody (N5, N6)', () => {
  it('renders the title, VI + ZH chips by role, the explanation and a marked example', () => {
    const { container } = render(
      <GrammarPointBody block={card} headingId="gp" />,
    );
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      'Hỏi số lượng với 几',
    );
    const chips = within(
      screen.getByRole('list', { name: 'Công thức' }),
    ).getAllByRole('listitem');
    expect(chips.map((chip) => chip.className)).toEqual([
      'lu-chip is-subj',
      'lu-chip is-key',
      'lu-chip',
    ]);
    expect(chips.map((chip) => chip.textContent)).toEqual([
      '主语Chủ ngữ',
      '几Từ hỏi',
      '名词Danh từ',
    ]);
    expect(container.querySelector('.lu-desc')?.textContent).toBe(
      'Dùng 几 để hỏi số lượng nhỏ.',
    );
    // Chinese runs of Vietnamese text are tagged for the right font.
    expect(
      container.querySelector('.lu-desc [lang="zh-Hans"]')?.textContent,
    ).toBe('几');
    expect(container.querySelector('mark.lu-hl')?.textContent).toBe('几');
    expect(container.querySelector('.uxa-gram__excn')?.textContent).toBe(
      '你家有几口人？',
    );
  });

  it('shows CMS text as text, never as markup', () => {
    const { container } = render(
      <GrammarPointBody
        block={{
          ...card,
          title: '<b>x</b>',
          explanation: '<b>x</b>',
          examples: [
            { ...card.examples[0]!, vi: '<img src=x onerror=alert(1)>' },
          ],
        }}
        headingId="gp"
      />,
    );
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      '<b>x</b>',
    );
    expect(container.querySelector('.lu-desc')?.textContent).toBe('<b>x</b>');
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});

const talk: DialogueBlock = {
  kind: 'dialogue',
  lines: [
    {
      speaker: 'An',
      hanzi: '你家有几口人？',
      pinyin: 'Nǐ jiā yǒu jǐ kǒu rén?',
      vi: 'Nhà bạn có mấy người?',
    },
    {
      speaker: 'Bình',
      hanzi: '我家有四口人。',
      pinyin: 'Wǒ jiā yǒu sì kǒu rén.',
      vi: 'Nhà tôi có bốn người.',
    },
    { speaker: 'An', hanzi: '<b>x</b>', pinyin: 'x', vi: 'x' },
  ],
};

describe('DialogueLines (N7)', () => {
  it('shows each turn with the speaker initial, hanzi, pinyin and meaning', () => {
    const { container } = render(<DialogueLines lines={talk.lines} />);
    const lines = screen.getAllByRole('listitem');
    expect(lines.map((line) => line.className)).toEqual([
      'lu-line is-a',
      'lu-line is-b',
      'lu-line is-a',
    ]);
    const who = within(lines[1]!).getByLabelText('Bình');
    expect(who.textContent).toBe('B');
    expect(lines[0]!.textContent).toBe(
      'A你家有几口人？Nǐ jiā yǒu jǐ kǒu rén?Nhà bạn có mấy người?',
    );
    expect(lines[2]!.querySelector('.lu-line__cn')?.textContent).toBe(
      '<b>x</b>',
    );
    expect(container.querySelector('b')).toBeNull();
  });
  it('puts the key-text audio in the header, not in a turn', () => {
    render(<DialogueLines lines={talk.lines} audio={{ mediaId: 7 }} />);
    const button = screen.getByRole('button', { name: 'Nghe bài khoá' });
    expect(button).toHaveClass('lu-say');
    for (const line of screen.getAllByRole('listitem')) {
      expect(line.contains(button)).toBe(false);
    }
    // A lone key text needs no number.
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('numbers each key text of a topic with several, with its own audio', () => {
    render(
      <>
        <DialogueLines lines={talk.lines} audio={{ mediaId: 7 }} number={1} />
        <DialogueLines lines={talk.lines} audio={{ mediaId: 8 }} number={2} />
      </>,
    );
    const second = screen.getByRole('region', { name: 'Bài khoá 2' });
    expect(
      within(second).getByRole('heading', { level: 3, name: 'Bài khoá 2' }),
    ).toBeInTheDocument();
    expect(
      within(second).getByRole('button', { name: 'Nghe bài khoá 2' }),
    ).toBeInTheDocument();
    expect(within(second).getAllByRole('listitem')).toHaveLength(3);
    expect(
      screen.getByRole('button', { name: 'Nghe bài khoá 1' }),
    ).toBeInTheDocument();
  });

  it('shows no audio button without key-text audio', () => {
    render(<DialogueLines lines={talk.lines} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('dialogueNumbers', () => {
  it('numbers dialogues only when a topic has more than one', () => {
    const dialogue = { kind: 'dialogue' };
    const text = { kind: 'text' };
    expect(dialogueNumbers([dialogue, text])).toEqual([undefined, undefined]);
    expect(dialogueNumbers([dialogue, text, dialogue, dialogue])).toEqual([
      1,
      undefined,
      2,
      3,
    ]);
  });
});
