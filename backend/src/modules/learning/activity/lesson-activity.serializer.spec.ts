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
        type: 'mcq',
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
      media: null,
      score: 100,
    });
    expect(response).not.toHaveProperty('userId');
    expect(response).not.toHaveProperty('answer');
    expect(response).not.toHaveProperty('contentSnapshot');
    expect(response).not.toHaveProperty('detailJson');
    expect(JSON.stringify(response)).not.toContain('authoritative-secret');
  });

  it('reads replay-safe media from the immutable snapshot only', () => {
    const response = serializeLessonAttempt({
      id: 10,
      exerciseId: 4,
      attemptNumber: 1,
      contentSnapshot: {
        type: 'listening_choice',
        media: {
          id: 44,
          url: 'https://cdn.example.test/snapshotted.mp3',
          type: 'audio',
          mimeType: 'audio/mpeg',
          duration: 21,
          storageProvider: 's3',
          storageKey: 'private/key.mp3',
          checksum: 'internal',
        },
      },
      isCorrect: true,
      score: 100,
      durationSeconds: 4,
      exerciseVersion: 3,
      feedbackVersion: 'lesson-activity-v1',
      submittedAt: new Date('2026-08-11T00:00:00Z'),
    });

    expect(response.media).toEqual({
      id: 44,
      url: 'https://cdn.example.test/snapshotted.mp3',
      type: 'audio',
      mimeType: 'audio/mpeg',
      duration: 21,
    });
    expect(JSON.stringify(response)).not.toContain('storageProvider');
    expect(JSON.stringify(response)).not.toContain('storageKey');
    expect(JSON.stringify(response)).not.toContain('checksum');
  });
});
