import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { CourseDetail, CourseLesson } from './course-model';
import { HomeCourseCard } from './home-course-card';

const lesson = (
  id: number,
  position: number,
  state: CourseLesson['state'],
): CourseLesson => ({
  id,
  title: `Bài số ${id}`,
  slug: `bai-${id}`,
  position,
  state,
  completionPercent: 0,
});

const COURSE: CourseDetail = {
  code: 'E2E_TEXTBOOK',
  kind: 'textbook',
  curriculumVersion: 'HSK_2_0',
  title: 'Giáo trình E2E',
  description: null,
  enrolled: true,
  isCurrent: true,
  progress: { completedLessons: 1, totalLessons: 3 },
  units: [
    {
      orderIndex: 1,
      title: 'Cấp 1',
      gradeNumber: 1,
      volume: null,
      levelCode: null,
      lessons: [lesson(1, 1, 'done'), lesson(2, 2, 'current')],
    },
    {
      orderIndex: 2,
      title: 'Cấp 2',
      gradeNumber: 2,
      volume: null,
      levelCode: null,
      lessons: [lesson(3, 1, 'locked')],
    },
  ],
};

const continueHref = () =>
  screen.getByRole('link', { name: /^Học tiếp/ }).getAttribute('href');

describe('HomeCourseCard (C3b-UI2)', () => {
  it('continues in the lesson /learning/home names when it belongs to the course', () => {
    render(<HomeCourseCard course={COURSE} nextLessonId={1} />);
    expect(continueHref()).toBe('/learn/lessons/1');
  });

  it('falls back to the next lesson of the course when /learning/home names a lesson outside it', () => {
    render(<HomeCourseCard course={COURSE} nextLessonId={999} />);
    expect(continueHref()).toBe('/learn/lessons/2');
  });
});
