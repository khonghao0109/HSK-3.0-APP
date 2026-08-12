import { describe, expect, it } from 'vitest';

import { buildSessionLoginUrl, validateAppOrigin } from './session-navigation';

describe('canonical session navigation', () => {
  it('preserves the validated APP_ORIGIN instead of deriving a host from the request', () => {
    expect(buildSessionLoginUrl('http://127.0.0.1:3200')).toBe(
      'http://127.0.0.1:3200/login?reason=session',
    );
    expect(buildSessionLoginUrl('https://admin.example.test')).toBe(
      'https://admin.example.test/login?reason=session',
    );
  });

  it.each([
    'ftp://frontend.example.test',
    'https://user:password@frontend.example.test',
    'https://frontend.example.test/path',
    'https://frontend.example.test?host=attacker.example',
    'https://frontend.example.test#fragment',
  ])('rejects a non-origin APP_ORIGIN value %s', (value) => {
    expect(() => validateAppOrigin(value)).toThrowError(
      'APP_ORIGIN must be an absolute HTTP(S) origin.',
    );
  });
});
