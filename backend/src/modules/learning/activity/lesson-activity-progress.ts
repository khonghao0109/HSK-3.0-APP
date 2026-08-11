export type NextActivityAction =
  | 'start_topic'
  | 'submit_exercise'
  | 'complete_topic'
  | 'complete_lesson'
  | 'completed';

type OrderedExercise = { id: number; orderIndex: number };
type OrderedTopic = {
  id: number;
  orderIndex: number;
  exercises: OrderedExercise[];
};

export type NextActivityPointer = {
  currentTopicId: number | null;
  currentExerciseId: number | null;
  nextAction: NextActivityAction;
};

export function calculateCompletionPercent(
  completedUnits: number,
  totalUnits: number,
): number {
  if (totalUnits <= 0) return 0;
  return Math.max(
    0,
    Math.min(100, Math.round((completedUnits / totalUnits) * 100)),
  );
}

export function calculateLessonScore(
  attempts: Array<{ exerciseId: number; score: number | null }>,
): number | null {
  const bestScores = new Map<number, number>();
  for (const attempt of attempts) {
    if (attempt.score === null) continue;
    const current = bestScores.get(attempt.exerciseId);
    if (current === undefined || attempt.score > current) {
      bestScores.set(attempt.exerciseId, attempt.score);
    }
  }
  if (bestScores.size === 0) return null;
  const total = [...bestScores.values()].reduce((sum, score) => sum + score, 0);
  return Math.round(total / bestScores.size);
}

export function selectNextActivity(input: {
  topics: OrderedTopic[];
  standaloneExercises: OrderedExercise[];
  completedTopicIds: ReadonlySet<number>;
  attemptedExerciseIds: ReadonlySet<number>;
  lessonCompleted?: boolean;
}): NextActivityPointer {
  if (input.lessonCompleted) {
    return {
      currentTopicId: null,
      currentExerciseId: null,
      nextAction: 'completed',
    };
  }

  const topics = [...input.topics].sort(compareOrdered);
  for (const topic of topics) {
    if (input.completedTopicIds.has(topic.id)) continue;
    const exercises = [...topic.exercises].sort(compareOrdered);
    const nextExercise = exercises.find(
      (exercise) => !input.attemptedExerciseIds.has(exercise.id),
    );
    if (nextExercise) {
      return {
        currentTopicId: topic.id,
        currentExerciseId: nextExercise.id,
        nextAction: 'submit_exercise',
      };
    }
    return {
      currentTopicId: topic.id,
      currentExerciseId: null,
      nextAction: 'complete_topic',
    };
  }

  const standaloneExercises = [...input.standaloneExercises].sort(
    compareOrdered,
  );
  const nextStandalone = standaloneExercises.find(
    (exercise) => !input.attemptedExerciseIds.has(exercise.id),
  );
  if (nextStandalone) {
    return {
      currentTopicId: null,
      currentExerciseId: nextStandalone.id,
      nextAction: 'submit_exercise',
    };
  }

  return {
    currentTopicId: null,
    currentExerciseId: null,
    nextAction: 'complete_lesson',
  };
}

function compareOrdered(
  left: { id: number; orderIndex: number },
  right: { id: number; orderIndex: number },
): number {
  return left.orderIndex - right.orderIndex || left.id - right.id;
}
