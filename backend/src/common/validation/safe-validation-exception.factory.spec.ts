import { createSafeValidationException } from './safe-validation-exception.factory';

describe('createSafeValidationException', () => {
  it('does not reflect an attacker-controlled non-whitelisted property name', () => {
    const secret = 'AUTHORITATIVEANSWERSECRET';
    const exception = createSafeValidationException([
      {
        property: secret,
        constraints: {
          whitelistValidation: `property ${secret} should not exist`,
        },
        children: [],
      },
    ]);

    expect(exception.getResponse()).toMatchObject({
      code: 'REQUEST_VALIDATION_FAILED',
      errors: [{ path: '$.$unknown', codes: ['whitelistValidation'] }],
    });
    expect(JSON.stringify(exception.getResponse())).not.toContain(secret);
  });
});
