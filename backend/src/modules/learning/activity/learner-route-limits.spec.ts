import { AuthController, authMeLimit } from '../../auth/auth.controller';
import { MediaController } from '../../media/media.controller';
import {
  isNotMediaContentRoute,
  mediaContentIpLimit,
} from '../../media/media-content-ip-throttle';
import {
  grantTracker,
  mediaAccessLimit,
  mediaContentGrantLimit,
} from '../../media/media-content-throttle';
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
    ['production', 120, 60, 60, 600, 120],
    ['test', 1_000, 1_000, 1_000, 10_000, 1_000],
  ])(
    'resolves limits under NODE_ENV=%s',
    (
      nodeEnv,
      authMe,
      exerciseAttempt,
      contentGrant,
      contentIp,
      mediaAccess,
    ) => {
      withNodeEnv(nodeEnv, () => {
        expect(authMeLimit()).toBe(authMe);
        expect(exerciseAttemptLimit()).toBe(exerciseAttempt);
        expect(mediaContentGrantLimit()).toBe(contentGrant);
        expect(mediaContentIpLimit()).toBe(contentIp);
        expect(mediaAccessLimit()).toBe(mediaAccess);
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
    [
      'MediaController.getContent',
      MediaController.prototype,
      'getContent',
      mediaContentGrantLimit,
    ],
    [
      'MediaController.createAccess',
      MediaController.prototype,
      'createAccess',
      mediaAccessLimit,
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

  it('tracks only MediaController.getContent by grant', () => {
    const tracker = (method: string) =>
      Reflect.getMetadata(
        'THROTTLER:TRACKERdefault',
        Object.getOwnPropertyDescriptor(MediaController.prototype, method)
          ?.value as object,
      ) as unknown;

    expect(tracker('getContent')).toBe(grantTracker);
    expect(tracker('createAccess')).toBeUndefined();
  });

  it.each([
    [MediaController, 'getContent', false],
    [MediaController, 'createAccess', true],
    [AuthController, 'getProfile', true],
    [LessonActivityController, 'submitAttempt', true],
  ] as const)(
    'mediaContentIp skipIf for %p.%s is %p',
    (controller, method, skipped) => {
      const handler: unknown = Object.getOwnPropertyDescriptor(
        controller.prototype,
        method,
      )?.value;

      expect(
        isNotMediaContentRoute({
          getClass: () => controller,
          getHandler: () => handler,
        }),
      ).toBe(skipped);
    },
  );
});
