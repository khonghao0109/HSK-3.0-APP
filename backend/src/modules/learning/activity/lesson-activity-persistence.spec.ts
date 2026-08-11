import { classifyLessonActivityPersistenceError } from './lesson-activity-persistence';

describe('Lesson Activity persistence error classifier', () => {
  it.each([
    ['P2002', 'unique_conflict'],
    ['23505', 'unique_conflict'],
    ['P2034', 'concurrent_retry'],
    ['P2028', 'timeout'],
    ['40P01', 'concurrent_retry'],
    ['55P03', 'timeout'],
    ['57014', 'timeout'],
    ['08006', 'connection_error'],
    ['P1001', 'connection_error'],
  ] as const)(
    'classifies %s without reading raw messages',
    (code, expected) => {
      expect(
        classifyLessonActivityPersistenceError({
          message: 'postgresql://user:secret@host/database',
          cause: { code },
        }),
      ).toBe(expected);
    },
  );
});
