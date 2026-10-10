import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';

import { LearnerPathLevels } from './learner-path-levels';
import type {
  LessonState,
  PathLesson,
  PathLevel,
} from './learning-path-contract';

function lesson(
  id: number,
  position: number,
  state: LessonState,
  title: string,
): PathLesson {
  return {
    id,
    title,
    slug: `lesson-${id}`,
    position,
    state,
    completionPercent: 0,
  };
}

const hsk3: PathLevel = {
  id: 3,
  code: 'HSK3',
  name: 'HSK 3',
  orderIndex: 3,
  lessonCount: 12,
  completedCount: 1,
  // Deliberately out of position order.
  lessons: [
    lesson(30, 3, 'available', 'Mua sắm'),
    lesson(10, 1, 'done', 'Chào hỏi'),
    lesson(40, 4, 'locked', 'Du lịch'),
    lesson(20, 2, 'current', 'Gia đình'),
  ],
};

const hsk2Empty: PathLevel = {
  id: 2,
  code: 'HSK2',
  name: 'HSK 2',
  orderIndex: 2,
  lessonCount: 0,
  completedCount: 0,
  lessons: [],
};

const LABELS = [
  'HSK 1',
  'HSK 2',
  'HSK 3',
  'HSK 4',
  'HSK 5',
  'HSK 6',
  'HSK 7–9',
];

function renderLevels(initialCode: string, levels: PathLevel[] = [hsk3]) {
  return render(
    <LearnerToastProvider>
      <LearnerPathLevels levels={levels} initialCode={initialCode} />
    </LearnerToastProvider>,
  );
}

function selectedTab() {
  return screen
    .getAllByRole('tab')
    .filter((tab) => tab.getAttribute('aria-selected') === 'true');
}

function tile(title: string) {
  const name = screen.getByText(title, { selector: '.topic__name' });
  const button = name.closest('button');
  if (!button) throw new Error(`no tile for ${title}`);
  return button;
}

describe('LearnerPathLevels', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('renders exactly seven tabs in level order', () => {
    renderLevels('HSK3');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(LABELS);
  });

  it('selects initialCode by default with roving tabIndex', () => {
    renderLevels('HSK3');
    const tabs = screen.getAllByRole('tab');
    tabs.forEach((tab, index) => {
      expect(tab).toHaveAttribute('aria-controls', 'path-panel');
      expect(tab).toHaveAttribute(
        'aria-selected',
        index === 2 ? 'true' : 'false',
      );
      expect(tab.tabIndex).toBe(index === 2 ? 0 : -1);
    });
  });

  it('falls back to HSK 1 for an unknown initialCode', () => {
    renderLevels('HSK10');
    expect(selectedTab().map((tab) => tab.textContent)).toEqual(['HSK 1']);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Lộ trình HSK 1' }),
    ).toBeInTheDocument();
  });

  it('shows the not-open message for a level missing from data', () => {
    const { container } = renderLevels('HSK5');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Lộ trình HSK 5' }),
    ).toBeInTheDocument();
    expect(screen.getByText('HSK 5 chưa mở.', { selector: 'p' })).toBeVisible();
    expect(container.querySelector('ol')).toBeNull();
  });

  it('shows the not-open message for a level with no lessons', () => {
    const { container } = renderLevels('HSK2', [hsk2Empty, hsk3]);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Lộ trình HSK 2' }),
    ).toBeInTheDocument();
    expect(screen.getByText('HSK 2 chưa mở.', { selector: 'p' })).toBeVisible();
    expect(container.querySelector('ol')).toBeNull();
  });

  it('lists lessons in position order with the lesson count', () => {
    const { container } = renderLevels('HSK3');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Lộ trình HSK 3' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Hoàn thành 12 bài để nắm vững HSK 3'),
    ).toBeInTheDocument();
    expect(screen.queryByText('HSK 3 chưa mở.')).toBeNull();
    const buttons = container.querySelectorAll(
      'ol.path-grid > li > button.topic',
    );
    expect(
      Array.from(buttons).map(
        (button) => button.querySelector('.topic__name')?.textContent,
      ),
    ).toEqual(['Chào hỏi', 'Gia đình', 'Mua sắm', 'Du lịch']);
  });

  it('moves selection and focus with arrow, Home and End keys', () => {
    renderLevels('HSK1');
    const tabs = screen.getAllByRole('tab');
    const expectSelected = (index: number) => {
      expect(selectedTab()).toEqual([tabs[index]]);
      expect(tabs[index]).toHaveFocus();
    };
    const first = tabs[0];
    if (!first) throw new Error('missing tab');
    first.focus();

    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expectSelected(1);
    fireEvent.keyDown(document.activeElement ?? first, { key: 'ArrowLeft' });
    expectSelected(0);
    fireEvent.keyDown(document.activeElement ?? first, { key: 'ArrowLeft' });
    expectSelected(6);
    fireEvent.keyDown(document.activeElement ?? first, { key: 'ArrowRight' });
    expectSelected(0);
    fireEvent.keyDown(document.activeElement ?? first, { key: 'End' });
    expectSelected(6);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Lộ trình HSK 7–9' }),
    ).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? first, { key: 'Home' });
    expectSelected(0);
  });

  it('selects a tab on click without fetching', () => {
    renderLevels('HSK1');
    fireEvent.click(screen.getByRole('tab', { name: 'HSK 3' }));
    expect(selectedTab().map((tab) => tab.textContent)).toEqual(['HSK 3']);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Lộ trình HSK 3' }),
    ).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'HSK 3' }), {
      key: 'ArrowRight',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['done', 'Chào hỏi', 'i-check-circle', ', đã hoàn thành'],
    ['current', 'Gia đình', null, ', đang học'],
    ['available', 'Mua sắm', null, ', có thể học'],
    ['locked', 'Du lịch', 'i-lock-fill', ', đã khoá'],
  ])('renders a %s tile', (state, title, icon, srText) => {
    renderLevels('HSK3');
    const button = tile(title);
    expect(button.getAttribute('class')).toBe(`topic is-${state}`);
    const children = Array.from(button.children);
    const expectedClasses = [
      'topic__no',
      ...(icon ? ['icon topic__state'] : []),
      'topic__art',
      'topic__name',
      'sr-only',
    ];
    expect(children.map((child) => child.getAttribute('class'))).toEqual(
      expectedClasses,
    );
    const stateIcon = button.querySelector('svg.topic__state');
    if (icon) {
      expect(stateIcon?.querySelector('use')?.getAttribute('href')).toBe(
        `#${icon}`,
      );
    } else {
      expect(stateIcon).toBeNull();
    }
    expect(button.querySelector('span.topic__art')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(button.querySelector('span.sr-only')?.textContent).toBe(srText);
  });

  it.each(['altKey', 'ctrlKey', 'metaKey'])(
    'ignores arrow, Home and End keys while %s is held',
    (modifier) => {
      renderLevels('HSK1');
      const first = screen.getAllByRole('tab')[0];
      if (!first) throw new Error('missing tab');
      first.focus();
      for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
        fireEvent.keyDown(first, { key, [modifier]: true });
      }
      expect(selectedTab()).toEqual([first]);
      expect(first).toHaveFocus();
    },
  );

  it('makes only the empty level panel focusable', () => {
    renderLevels('HSK3');
    const panel = screen.getByRole('tabpanel');
    expect(panel).not.toHaveAttribute('tabindex');
    fireEvent.click(screen.getByRole('tab', { name: 'HSK 2' }));
    expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '0');
    fireEvent.click(screen.getByRole('tab', { name: 'HSK 4' }));
    expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '0');
  });

  it('marks the current lesson as the step', () => {
    renderLevels('HSK3');
    expect(tile('Gia đình')).toHaveAttribute('aria-current', 'step');
    expect(tile('Mua sắm')).not.toHaveAttribute('aria-current');
  });

  it('keeps a locked tile focusable and toasts the lock message', () => {
    renderLevels('HSK3');
    const locked = tile('Du lịch');
    expect(locked).toHaveAttribute('aria-disabled', 'true');
    expect(locked).not.toHaveAttribute('disabled');
    fireEvent.click(locked);
    expect(
      within(screen.getByRole('status')).getByText(
        'Hoàn thành bài trước để mở khoá.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Tính năng sắp ra mắt.')).toBeNull();
  });

  it.each(['Chào hỏi', 'Gia đình', 'Mua sắm'])(
    'toasts coming soon for open tile %s',
    (title) => {
      renderLevels('HSK3');
      expect(tile(title)).not.toHaveAttribute('aria-disabled');
      fireEvent.click(tile(title));
      expect(
        within(screen.getByRole('status')).getByText('Tính năng sắp ra mắt.'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Hoàn thành bài trước để mở khoá.')).toBeNull();
    },
  );

  it('uses no inline style', () => {
    const { container } = renderLevels('HSK3');
    expect(container.querySelector('[style]')).toBeNull();
  });
});
