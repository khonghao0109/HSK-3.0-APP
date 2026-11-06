import type { LearningPath } from '@/features/learner-path/learning-path-contract';

export type NextStep = { href: string; label: 'Bài tiếp theo' | 'Về lộ trình' };

/**
 * Main button of the complete page (Q61): the next lesson of the same Level
 * by path position, or back to the path after the Level's last lesson.
 */
export function nextStepAfter(path: LearningPath, lessonId: number): NextStep {
  for (const level of path.levels) {
    const lessons = [...level.lessons].sort((a, b) => a.position - b.position);
    const index = lessons.findIndex((lesson) => lesson.id === lessonId);
    if (index === -1) continue;
    const next = lessons[index + 1];
    if (next)
      return { href: `/learn/lessons/${next.id}`, label: 'Bài tiếp theo' };
    break;
  }
  return { href: '/learn/path', label: 'Về lộ trình' };
}

/** Whole percent shown on the medal and the score tile (Q59); null when no attempt was scored. */
export function displayScore(score: number | null): number | null {
  return score === null ? null : Math.round(score);
}
