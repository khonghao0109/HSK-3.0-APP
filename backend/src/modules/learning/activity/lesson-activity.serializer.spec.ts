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

describe('Lesson Activity serializer — correctAnswer reveal (Q-G9)', () => {
  function serialize(input: {
    type: string;
    authoritativeAnswer: unknown;
    isCorrect: boolean | null;
  }) {
    return serializeLessonAttempt({
      id: 1,
      exerciseId: 2,
      attemptNumber: 1,
      isCorrect: input.isCorrect,
      score: input.isCorrect ? 100 : 0,
      durationSeconds: 5,
      exerciseVersion: 1,
      feedbackVersion: 'lesson-activity-v1',
      submittedAt: new Date('2026-11-22T00:00:00Z'),
      contentSnapshot: {
        type: input.type,
        authoritativeAnswer: input.authoritativeAnswer,
        explanation: null,
      },
    });
  }

  it('reveals the chosen option id on a wrong mcq', () => {
    const response = serialize({
      type: 'mcq',
      authoritativeAnswer: { optionId: 'o3' },
      isCorrect: false,
    });
    expect(response.correctAnswer).toEqual({ optionId: 'o3' });
  });

  it('reveals the option id on a wrong listening_choice', () => {
    const response = serialize({
      type: 'listening_choice',
      authoritativeAnswer: { optionId: 'o1' },
      isCorrect: false,
    });
    expect(response.correctAnswer).toEqual({ optionId: 'o1' });
  });

  it('reveals accepted texts and case flag on a wrong fill_blank', () => {
    const response = serialize({
      type: 'fill_blank',
      authoritativeAnswer: {
        acceptedTexts: ['好', 'hǎo'],
        caseSensitive: false,
      },
      isCorrect: false,
    });
    expect(response.correctAnswer).toEqual({
      acceptedTexts: ['好', 'hǎo'],
      caseSensitive: false,
    });
  });

  it('keeps caseSensitive true when the snapshot sets it', () => {
    const response = serialize({
      type: 'fill_blank',
      authoritativeAnswer: { acceptedTexts: ['OK'], caseSensitive: true },
      isCorrect: false,
    });
    expect(response.correctAnswer).toEqual({
      acceptedTexts: ['OK'],
      caseSensitive: true,
    });
  });

  it('reveals the ordered token ids on a wrong arrange_sentence', () => {
    const response = serialize({
      type: 'arrange_sentence',
      authoritativeAnswer: { tokenIds: ['t1', 't2', 't3'] },
      isCorrect: false,
    });
    expect(response.correctAnswer).toEqual({ tokenIds: ['t1', 't2', 't3'] });
  });

  it('never reveals an answer for matching', () => {
    const response = serialize({
      type: 'matching',
      authoritativeAnswer: { pairs: [{ id: 'p1' }] },
      isCorrect: false,
    });
    expect(response).not.toHaveProperty('correctAnswer');
  });

  it('omits correctAnswer when the attempt is correct', () => {
    const response = serialize({
      type: 'mcq',
      authoritativeAnswer: { optionId: 'o3' },
      isCorrect: true,
    });
    expect(response).not.toHaveProperty('correctAnswer');
  });

  it('omits correctAnswer when correctness is unknown (null)', () => {
    const response = serialize({
      type: 'mcq',
      authoritativeAnswer: { optionId: 'o3' },
      isCorrect: null,
    });
    expect(response).not.toHaveProperty('correctAnswer');
  });

  it('omits correctAnswer when the snapshot answer is missing', () => {
    const response = serializeLessonAttempt({
      id: 1,
      exerciseId: 2,
      attemptNumber: 1,
      isCorrect: false,
      score: 0,
      durationSeconds: 5,
      exerciseVersion: 1,
      feedbackVersion: 'lesson-activity-v1',
      submittedAt: new Date('2026-11-22T00:00:00Z'),
      contentSnapshot: { type: 'mcq', explanation: null },
    });
    expect(response).not.toHaveProperty('correctAnswer');
  });

  it('omits correctAnswer when the snapshot shape is corrupt, without throwing', () => {
    const response = serialize({
      type: 'mcq',
      authoritativeAnswer: { optionId: 42 },
      isCorrect: false,
    });
    expect(response).not.toHaveProperty('correctAnswer');
  });

  it('omits correctAnswer for an unknown exercise type', () => {
    const response = serialize({
      type: 'speaking_repeat',
      authoritativeAnswer: { optionId: 'o1' },
      isCorrect: false,
    });
    expect(response).not.toHaveProperty('correctAnswer');
  });
});
