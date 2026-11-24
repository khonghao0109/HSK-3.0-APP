import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';

import type { CourseLesson, CourseUnit } from './course-model';
import { CourseUnits } from './course-units';

const lesson = (
  id: number,
  position: number,
  state: CourseLesson['state'],
  completionPercent = 0,
): CourseLesson => ({
  id,
  title: `Bài số ${id}`,
  slug: `bai-${id}`,
  position,
  state,
  completionPercent,
});

const UNITS: CourseUnit[] = [
  {
    orderIndex: 1,
    title: 'Cấp 1',
    gradeNumber: 1,
    volume: null,
    levelCode: null,
    lessons: [lesson(1, 1, 'done', 100), lesson(2, 2, 'done', 100)],
  },
  {
    orderIndex: 2,
    title: 'Cấp 4',
    gradeNumber: 4,
    volume: 'upper',
    levelCode: null,
    lessons: [
      lesson(3, 1, 'done', 100),
      lesson(4, 2, 'current', 40),
      lesson(5, 3, 'locked'),
    ],
  },
  {
    orderIndex: 3,
    title: 'Cấp 4',
    gradeNumber: 4,
    volume: 'lower',
    levelCode: null,
    lessons: [lesson(6, 1, 'locked')],
  },
];

function renderUnits(units = UNITS) {
  render(
    <LearnerToastProvider>
      <CourseUnits units={units} />
    </LearnerToastProvider>,
  );
}

const head = (name: RegExp) => screen.getByRole('button', { name });

describe('CourseUnits (C3b-UI, PO 24/11)', () => {
  it('opens only the unit of the current lesson', () => {
    renderUnits();
    const heads = screen
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('aria-expanded'));
    expect(heads.map((b) => b.getAttribute('aria-expanded'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(screen.queryByRole('link', { name: /Bài số 1/ })).toBeNull();
    const current = screen.getByRole('link', { name: /Bài số 4/ });
    expect(current).toHaveAttribute('href', '/learn/lessons/4');
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(current).toHaveTextContent('Đang học · 40%');
    expect(head(/Cấp 4.*Quyển thượng/)).toHaveTextContent('3 bài · 1 đã xong');
    expect(head(/Cấp 1/)).toHaveTextContent('Đã xong');
  });

  it('toggles a unit and keeps locked lessons as disabled buttons', () => {
    renderUnits();
    const first = head(/^Cấp 1/);
    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    const done = screen.getByRole('link', { name: /Bài số 1/ });
    expect(done).toHaveTextContent('Đã xong');
    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'false');

    const lower = head(/Quyển hạ/);
    expect(lower).toHaveTextContent('Chưa mở');
    fireEvent.click(lower);
    const body = document.getElementById(
      lower.getAttribute('aria-controls') ?? '',
    );
    const locked = within(body as HTMLElement).getByRole('button', {
      name: /Bài số 6/,
    });
    expect(locked).toHaveAttribute('aria-disabled', 'true');
    expect(locked).toHaveTextContent('Chưa mở');
    expect(screen.queryByRole('link', { name: /Bài số 6/ })).toBeNull();
    fireEvent.click(locked);
    expect(
      screen.getByText('Hoàn thành bài trước để mở khoá.'),
    ).toBeInTheDocument();
  });

  it('opens the unit of the first open lesson when none is current', () => {
    renderUnits([
      UNITS[0] as CourseUnit,
      { ...(UNITS[2] as CourseUnit), lessons: [lesson(7, 1, 'available')] },
    ]);
    const link = screen.getByRole('link', { name: /Bài số 7/ });
    expect(link).toHaveTextContent('Đã mở');
    expect(head(/Quyển hạ/)).toHaveAttribute('aria-expanded', 'true');
    expect(head(/Quyển hạ/)).toHaveTextContent('Đã mở bài đầu');
  });
});
