import { describe, expect, it } from 'vitest';

import { parseServerEnv } from './env-schema';

describe('server env schema', () => {
  it('parses valid environment with default session cookie names', () => {
    const env = parseServerEnv({});
    expect(env.SESSION_COOKIE_NAME).toBe('hsk_admin_session');
    expect(env.LEARNER_SESSION_COOKIE_NAME).toBe('hsk_learner_session');
  });

  it('rejects when learner session cookie name equals admin session cookie name', () => {
    expect(() =>
      parseServerEnv({
        SESSION_COOKIE_NAME: 'hsk_shared_session',
        LEARNER_SESSION_COOKIE_NAME: 'hsk_shared_session',
      }),
    ).toThrow();
  });

  it('rejects when learner session cookie name collides with admin refresh cookie name', () => {
    expect(() =>
      parseServerEnv({
        SESSION_COOKIE_NAME: 'hsk_admin',
        LEARNER_SESSION_COOKIE_NAME: 'hsk_admin_refresh',
      }),
    ).toThrow();
  });

  it('rejects when learner refresh cookie name collides with admin cookie name', () => {
    expect(() =>
      parseServerEnv({
        SESSION_COOKIE_NAME: 'hsk_cookie_refresh',
        LEARNER_SESSION_COOKIE_NAME: 'hsk_cookie',
      }),
    ).toThrow();
  });
});
