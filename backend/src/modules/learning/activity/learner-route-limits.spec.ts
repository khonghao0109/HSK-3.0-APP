import { AuthController, authMeLimit } from '../../auth/auth.controller';
import {
  exerciseAttemptLimit,
  LessonActivityController,
} from './lesson-activity.controller';

function withNodeEnv(nodeEnv: string, run: () => void): void {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;
  try {
    run();
  } finally {
    process.env.NODE_ENV = previous;
  }
}

describe('learner route limits', () => {
  it.each([
    ['production', 120, 60],
    ['test', 1_000, 1_000],
  ])(
    'resolves limits under NODE_ENV=%s',
    (nodeEnv, authMe, exerciseAttempt) => {
      withNodeEnv(nodeEnv, () => {
        expect(authMeLimit()).toBe(authMe);
        expect(exerciseAttemptLimit()).toBe(exerciseAttempt);
      });
    },
  );

  it.each([
    [
      'AuthController.getProfile',
      AuthController.prototype,
      'getProfile',
      authMeLimit,
    ],
    [
      'LessonActivityController.submitAttempt',
      LessonActivityController.prototype,
      'submitAttempt',
      exerciseAttemptLimit,
    ],
  ] as const)(
    '%s carries its own throttle metadata',
    (_name, proto, method, limit) => {
      const handler: unknown = Object.getOwnPropertyDescriptor(
        proto,
        method,
      )?.value;
      expect(
        Reflect.getMetadata('THROTTLER:LIMITdefault', handler as object),
      ).toBe(limit);
      expect(
        Reflect.getMetadata('THROTTLER:TTLdefault', handler as object),
      ).toBe(60_000);
    },
  );
});
