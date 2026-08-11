import { serializeLessonAttempt } from './lesson-activity.serializer';

describe('Lesson Activity response serializer', () => {
  it('exposes only the safe attempt summary', () => {
    const response = serializeLessonAttempt({
      id: 9,
      userId: 88,
      exerciseId: 3,
      attemptNumber: 1,
      answer: { optionId: 'secret-choice' },
      contentSnapshot: {
        answer: { optionId: 'authoritative-secret' },
        explanation: 'Safe feedback',
      },
      detailJson: { requestHash: 'internal' },
      isCorrect: true,
      score: 100,
      durationSeconds: 12,
      exerciseVersion: 4,
      feedbackVersion: 'lesson-activity-v1',
      submittedAt: new Date('2026-08-10T00:00:00Z'),
    });

    expect(response).toMatchObject({
      attemptId: 9,
      exerciseId: 3,
      explanation: 'Safe feedback',
      score: 100,
    });
    expect(response).not.toHaveProperty('userId');
    expect(response).not.toHaveProperty('answer');
    expect(response).not.toHaveProperty('contentSnapshot');
    expect(response).not.toHaveProperty('detailJson');
    expect(JSON.stringify(response)).not.toContain('authoritative-secret');
  });
});
