import { describe, expect, it } from 'vitest';

import {
  parseExerciseQuery,
  serializeExerciseQuery,
  withExercisePage,
} from './exercise-query';

describe('exercise URL query contract', () => {
  it('parses supported server-side filters and clamps invalid pagination', () => {
    expect(
      parseExerciseQuery({
        page: '3',
        limit: '20',
        lessonId: '12',
        topicId: '34',
        type: 'listening_choice',
        status: 'published',
        ignored: 'secret',
      }),
    ).toEqual({
      page: 3,
      limit: 20,
      lessonId: 12,
      topicId: 34,
      type: 'listening_choice',
      status: 'published',
    });
    expect(parseExerciseQuery({ page: '-1', limit: '999' })).toMatchObject({
      page: 1,
      limit: 20,
    });
  });

  it('serializes only allowlisted non-empty filters', () => {
    expect(
      serializeExerciseQuery({
        page: 2,
        limit: 20,
        lessonId: 12,
        topicId: undefined,
        type: 'mcq',
        status: undefined,
      }).toString(),
    ).toBe('page=2&limit=20&lessonId=12&type=mcq');
  });

  it('preserves filters when pagination changes', () => {
    expect(
      withExercisePage({ page: 1, limit: 20, status: 'draft' }, 4),
    ).toContain('status=draft');
    expect(
      withExercisePage({ page: 1, limit: 20, status: 'draft' }, 4),
    ).toContain('page=4');
  });
});
