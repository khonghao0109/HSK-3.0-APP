import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OnboardingGoalForm } from './onboarding-goal-form';
import type { LevelItem } from './onboarding-contract';

const push = vi.fn();
let currentSearchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => currentSearchParams,
}));

function getLiveRegion(): HTMLElement {
  const regions = document.querySelectorAll<HTMLElement>(
    '[aria-live="polite"]',
  );
  expect(regions).toHaveLength(1);
  const region = regions[0];
  if (!region) throw new Error('live region missing');
  return region;
}

function expectRovingTabIndex(groupName: string, selectedName: string) {
  const group = screen.getByRole('radiogroup', { name: groupName });
  const radios = within(group).getAllByRole('radio');
  for (const radio of radios) {
    const isSelected = radio.getAttribute('aria-checked') === 'true';
    expect(radio.tabIndex).toBe(isSelected ? 0 : -1);
  }
  expect(
    radios.filter((radio) => radio.getAttribute('aria-checked') === 'true'),
  ).toHaveLength(1);
  expect(
    within(group).getByRole('radio', { name: selectedName }).tabIndex,
  ).toBe(0);
}

const sampleLevels: LevelItem[] = [
  { id: 1, name: 'HSK 1', orderIndex: 1, code: 'HSK1', minBand: 1, maxBand: 1 },
  { id: 2, name: 'HSK 2', orderIndex: 2, code: 'HSK2', minBand: 2, maxBand: 2 },
  { id: 3, name: 'HSK 3', orderIndex: 3, code: 'HSK3', minBand: 3, maxBand: 3 },
  {
    id: 7,
    name: 'HSK 7-9',
    orderIndex: 7,
    code: 'HSK7_9',
    minBand: 7,
    maxBand: 9,
  },
];

describe('OnboardingGoalForm', () => {
  beforeEach(() => {
    push.mockReset();
    vi.restoreAllMocks();
    currentSearchParams = new URLSearchParams();
  });

  it('renders default Giao tiep and HSK 3 with 2.245 tu vung, and verifies rendered copy for 7/8/9', async () => {
    const user = userEvent.setup();
    render(
      <OnboardingGoalForm
        initialPurpose="communication"
        initialBand={3}
        hasGoal={false}
        levels={sampleLevels}
      />,
    );

    const commRadio = screen.getByRole('radio', { name: /Giao tiếp/i });
    expect(commRadio).toHaveAttribute('aria-checked', 'true');

    const band3Radio = screen.getByRole('radio', { name: '3' });
    expect(band3Radio).toHaveAttribute('aria-checked', 'true');

    expect(screen.getByText('HSK 3 ~ 2.245 từ vựng')).toBeInTheDocument();
    expect(
      screen.getByText(/Có thể giao tiếp trong các tình huống/),
    ).toBeInTheDocument();

    const expectedCopy: Array<[string, string, string]> = [
      [
        '7',
        'HSK 7 ~ 11.092 từ vựng (chung cấp 7–9)',
        'Sử dụng tiếng Trung trong học thuậtvà công việc chuyên môn.',
      ],
      [
        '8',
        'HSK 8 ~ 11.092 từ vựng (chung cấp 7–9)',
        'Xử lý văn bản và thảo luận chuyên sâuở mức độ cao.',
      ],
      [
        '9',
        'HSK 9 ~ 11.092 từ vựng (chung cấp 7–9)',
        'Thành thạo gần như người bản ngữtrong mọi lĩnh vực.',
      ],
    ];
    for (const [bandName, title, desc] of expectedCopy) {
      await user.click(screen.getByRole('radio', { name: bandName }));
      const titleEl = document.getElementById('level-title');
      const descEl = document.getElementById('level-desc');
      expect(titleEl).toBeVisible();
      expect(titleEl).toHaveTextContent(title, { normalizeWhitespace: false });
      expect(descEl).toBeVisible();
      expect(descEl?.textContent).toBe(desc);
      expect(getLiveRegion()).toContainElement(titleEl);
    }
  });

  it('shows Q10 alert and sets aria-disabled when an unavailable band is selected', async () => {
    const user = userEvent.setup();
    render(
      <OnboardingGoalForm
        initialPurpose="communication"
        initialBand={3}
        hasGoal={false}
        levels={sampleLevels}
      />,
    );

    const continueBtn = screen.getByRole('button', { name: 'Tiếp tục' });
    expect(continueBtn).not.toHaveAttribute('aria-disabled');

    // Click band 5 (not in sampleLevels)
    const band5Radio = screen.getByRole('radio', { name: '5' });
    await user.click(band5Radio);

    expect(band5Radio).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByText('HSK 5 chưa mở. Hãy chọn cấp độ khác.'),
    ).toBeInTheDocument();
    expect(continueBtn).toHaveAttribute('aria-disabled', 'true');

    // Clicking continue does not navigate
    await user.click(continueBtn);
    expect(push).not.toHaveBeenCalled();
  });

  it('keeps one live region node and links the Q10 warning via aria-describedby only while blocked', async () => {
    const user = userEvent.setup();
    render(
      <OnboardingGoalForm
        initialPurpose="communication"
        initialBand={3}
        hasGoal={false}
        levels={sampleLevels}
      />,
    );

    const continueBtn = screen.getByRole('button', { name: 'Tiếp tục' });
    const regionBefore = getLiveRegion();
    expect(regionBefore).toHaveClass('level-info');
    expect(regionBefore).not.toHaveClass('alert');
    expect(continueBtn).not.toHaveAttribute('aria-describedby');
    expect(document.getElementById('level-alert')).toBeNull();

    await user.click(screen.getByRole('radio', { name: '5' }));

    const regionBlocked = getLiveRegion();
    expect(regionBlocked).toBe(regionBefore);
    expect(regionBlocked).toHaveClass('alert', 'alert--error');
    expect(regionBlocked).not.toHaveClass('level-info');
    const warning = document.getElementById('level-alert');
    expect(warning).not.toBeNull();
    expect(regionBlocked).toContainElement(warning);
    expect(warning).toHaveTextContent('HSK 5 chưa mở. Hãy chọn cấp độ khác.');
    expect(document.getElementById('level-title')).toBeNull();
    expect(continueBtn).toHaveAttribute('aria-disabled', 'true');
    expect(continueBtn).toHaveAttribute('aria-describedby', 'level-alert');
    expect(continueBtn).toHaveAccessibleDescription(
      'HSK 5 chưa mở. Hãy chọn cấp độ khác.',
    );

    await user.click(screen.getByRole('radio', { name: '6' }));
    expect(getLiveRegion()).toBe(regionBefore);
    expect(document.getElementById('level-alert')).toHaveTextContent(
      'HSK 6 chưa mở. Hãy chọn cấp độ khác.',
    );

    await user.click(screen.getByRole('radio', { name: '2' }));
    const regionAfter = getLiveRegion();
    expect(regionAfter).toBe(regionBefore);
    expect(regionAfter).toHaveClass('level-info');
    expect(regionAfter).not.toHaveClass('alert');
    expect(document.getElementById('level-alert')).toBeNull();
    expect(regionAfter).toContainElement(
      document.getElementById('level-title'),
    );
    expect(continueBtn).not.toHaveAttribute('aria-disabled');
    expect(continueBtn).not.toHaveAttribute('aria-describedby');
  });

  it('prefers purpose and band from the current URL over stale initial props', () => {
    currentSearchParams = new URLSearchParams('purpose=work&band=7');
    render(
      <OnboardingGoalForm
        initialPurpose="communication"
        initialBand={3}
        hasGoal={false}
        levels={sampleLevels}
      />,
    );

    expect(screen.getByRole('radio', { name: /Công việc/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: /Giao tiếp/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('radio', { name: '7' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: '3' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(document.getElementById('level-title')).toHaveTextContent(
      'HSK 7 ~ 11.092 từ vựng (chung cấp 7–9)',
    );
  });

  it('falls back to initial props when URL params are invalid', () => {
    currentSearchParams = new URLSearchParams('purpose=bogus&band=10');
    render(
      <OnboardingGoalForm
        initialPurpose="hsk_exam"
        initialBand={2}
        hasGoal={false}
        levels={sampleLevels}
      />,
    );

    expect(screen.getByRole('radio', { name: /Thi HSK/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: '2' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('supports arrow key navigation in radio groups and calls replaceState', async () => {
    const user = userEvent.setup();
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

    render(
      <OnboardingGoalForm
        initialPurpose="communication"
        initialBand={3}
        hasGoal={false}
        levels={sampleLevels}
      />,
    );

    expectRovingTabIndex('Mục tiêu học tập', 'Giao tiếp');
    expectRovingTabIndex('Cấp độ HSK mục tiêu', '3');

    const commRadio = screen.getByRole('radio', { name: /Giao tiếp/i });
    commRadio.focus();

    // ArrowRight in purposes moves to 'Du học'
    await user.keyboard('{ArrowRight}');
    const studyAbroadRadio = screen.getByRole('radio', { name: /Du học/i });
    expect(studyAbroadRadio).toHaveAttribute('aria-checked', 'true');
    expect(replaceStateSpy).toHaveBeenCalledWith(
      null,
      '',
      '?purpose=study_abroad&band=3',
    );
    expect(studyAbroadRadio).toHaveFocus();
    expectRovingTabIndex('Mục tiêu học tập', 'Du học');
    expectRovingTabIndex('Cấp độ HSK mục tiêu', '3');

    // Focus levels radio and navigate
    const band3Radio = screen.getByRole('radio', { name: '3' });
    band3Radio.focus();
    await user.keyboard('{ArrowLeft}');
    const band2Radio = screen.getByRole('radio', { name: '2' });
    expect(band2Radio).toHaveAttribute('aria-checked', 'true');
    expect(replaceStateSpy).toHaveBeenCalledWith(
      null,
      '',
      '?purpose=study_abroad&band=2',
    );
    expect(band2Radio).toHaveFocus();
    expectRovingTabIndex('Cấp độ HSK mục tiêu', '2');
    expectRovingTabIndex('Mục tiêu học tập', 'Du học');
  });

  it('navigates with router.push to /onboarding/plan with correct query on continue', async () => {
    const user = userEvent.setup();
    render(
      <OnboardingGoalForm
        initialPurpose="hsk_exam"
        initialBand={1}
        hasGoal={false}
        levels={sampleLevels}
      />,
    );

    const continueBtn = screen.getByRole('button', { name: 'Tiếp tục' });
    await user.click(continueBtn);

    expect(push).toHaveBeenCalledWith(
      '/onboarding/plan?purpose=hsk_exam&band=1',
    );
  });

  it('complies with Q9 back button behavior for learner with and without goal', () => {
    // 1. Without goal: no back link, first child has aria-hidden
    const { unmount } = render(
      <OnboardingGoalForm
        initialPurpose="communication"
        initialBand={3}
        hasGoal={false}
        levels={sampleLevels}
      />,
    );

    expect(
      screen.queryByRole('link', { name: 'Quay lại' }),
    ).not.toBeInTheDocument();
    const topContainer = document.querySelector('.ob__top')!;
    expect(topContainer.firstElementChild).toHaveAttribute(
      'aria-hidden',
      'true',
    );

    unmount();

    // 2. With goal: back link to /learn
    render(
      <OnboardingGoalForm
        initialPurpose="communication"
        initialBand={3}
        hasGoal={true}
        levels={sampleLevels}
      />,
    );

    const backLink = screen.getByRole('link', { name: 'Quay lại' });
    expect(backLink).toBeInTheDocument();
    expect(backLink).toHaveAttribute('href', '/learn');
  });

  it('displays notice alert when notice=content_unavailable is passed', () => {
    render(
      <OnboardingGoalForm
        initialPurpose="communication"
        initialBand={3}
        hasGoal={false}
        levels={sampleLevels}
        notice="content_unavailable"
      />,
    );

    expect(
      screen.getByText(
        'Cấp độ bạn chọn hiện chưa có bài học. Hãy chọn cấp độ khác.',
      ),
    ).toBeInTheDocument();
  });
});
