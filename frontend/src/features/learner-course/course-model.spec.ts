import { describe, expect, it } from 'vitest';

import {
  curriculumLabel,
  nextCourseLesson,
  progressPercent,
  type CourseDetail,
  type CourseLesson,
} from './course-model';

const lesson = (id: number, state: CourseLesson['state']): CourseLesson => ({
  id,
  title: `Bài ${id}`,
  slug: `bai-${id}`,
  position: id,
  state,
  completionPercent: 0,
});

const course = (states: CourseLesson['state'][][]): CourseDetail => ({
  code: 'HSK2_TEXTBOOK',
  kind: 'textbook',
  curriculumVersion: 'HSK_2_0',
  title: 'Giáo trình',
  description: null,
  enrolled: true,
  isCurrent: true,
  progress: { completedLessons: 0, totalLessons: 0 },
  units: states.map((unit, u) => ({
    orderIndex: u + 1,
    title: `Cấp ${u + 1}`,
    gradeNumber: u + 1,
    volume: null,
    levelCode: null,
    lessons: unit.map((state, i) => lesson(u * 10 + i + 1, state)),
  })),
});

describe('course model (C3b-UI)', () => {
  it('picks the first current lesson, even after an open one', () => {
    const next = nextCourseLesson(
      course([
        ['done', 'available'],
        ['done', 'current', 'locked'],
      ]),
    );
    expect(next?.lesson.id).toBe(12);
    expect(next?.unit.title).toBe('Cấp 2');
  });

  it('falls back to the first open lesson, else none', () => {
    expect(
      nextCourseLesson(course([['done'], ['locked', 'available']]))?.lesson.id,
    ).toBe(12);
    expect(nextCourseLesson(course([['done'], ['locked']]))).toBeNull();
  });

  it('labels the curriculum and rounds the progress', () => {
    expect(curriculumLabel('HSK_2_0')).toBe('HSK 2.0');
    expect(curriculumLabel('HSK_3_0')).toBe('HSK 3.0');
    expect(curriculumLabel(null)).toBeNull();
    expect(progressPercent({ completedLessons: 4, totalLessons: 134 })).toBe(3);
    expect(progressPercent({ completedLessons: 0, totalLessons: 0 })).toBe(0);
  });
});
