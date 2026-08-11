import {
  calculateCompletionPercent,
  calculateLessonScore,
  selectNextActivity,
} from './lesson-activity-progress';

describe('Lesson Activity progress rules', () => {
  it('calculates rounded, clamped completion percentages', () => {
    expect(calculateCompletionPercent(1, 3)).toBe(33);
    expect(calculateCompletionPercent(3, 3)).toBe(100);
    expect(calculateCompletionPercent(0, 0)).toBe(0);
    expect(calculateCompletionPercent(5, 3)).toBe(100);
  });

  it('averages the best score for each attempted public exercise', () => {
    expect(
      calculateLessonScore([
        { exerciseId: 1, score: 40 },
        { exerciseId: 1, score: 100 },
        { exerciseId: 2, score: 50 },
      ]),
    ).toBe(75);
    expect(calculateLessonScore([])).toBeNull();
  });

  it('selects topics/exercises in stable order and skips completed facts', () => {
    expect(
      selectNextActivity({
        topics: [
          {
            id: 20,
            orderIndex: 2,
            exercises: [{ id: 202, orderIndex: 1 }],
          },
          {
            id: 10,
            orderIndex: 1,
            exercises: [
              { id: 102, orderIndex: 2 },
              { id: 101, orderIndex: 1 },
            ],
          },
        ],
        standaloneExercises: [{ id: 301, orderIndex: 1 }],
        completedTopicIds: new Set(),
        attemptedExerciseIds: new Set([101]),
      }),
    ).toEqual({
      currentTopicId: 10,
      currentExerciseId: 102,
      nextAction: 'submit_exercise',
    });
  });

  it('requests explicit topic and lesson completion at the correct boundaries', () => {
    const topicInput = {
      topics: [
        {
          id: 10,
          orderIndex: 1,
          exercises: [{ id: 101, orderIndex: 1 }],
        },
      ],
      standaloneExercises: [] as Array<{ id: number; orderIndex: number }>,
      completedTopicIds: new Set<number>(),
      attemptedExerciseIds: new Set([101]),
    };
    expect(selectNextActivity(topicInput)).toEqual({
      currentTopicId: 10,
      currentExerciseId: null,
      nextAction: 'complete_topic',
    });
    expect(
      selectNextActivity({
        ...topicInput,
        completedTopicIds: new Set([10]),
      }),
    ).toEqual({
      currentTopicId: null,
      currentExerciseId: null,
      nextAction: 'complete_lesson',
    });
  });
});
