import { correlationId } from './request-correlation';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('correlationId', () => {
  it('keeps an accepted UUID request id', () => {
    const requestId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    expect(correlationId(requestId)).toBe(requestId);
  });

  it('keeps an accepted 32-hex request id', () => {
    const requestId = '0123456789abcdef0123456789abcdef';
    expect(correlationId(requestId)).toBe(requestId);
  });

  it('generates a UUID when the header is absent or malformed', () => {
    expect(correlationId(undefined)).toMatch(UUID_PATTERN);
    expect(correlationId('not-a-request-id')).toMatch(UUID_PATTERN);
    expect(correlationId('')).toMatch(UUID_PATTERN);
  });
});
