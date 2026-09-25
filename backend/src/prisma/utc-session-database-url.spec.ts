import {
  pinUtcSessionOptions,
  withUtcSessionTimeZone,
} from './utc-session-database-url';

describe('withUtcSessionTimeZone', () => {
  it('adds the UTC session option to a URL without options', () => {
    const url = new URL(
      withUtcSessionTimeZone(
        'postgresql://app:secret@db.internal:5432/hsk?schema=public&connection_limit=5',
      ),
    );

    expect(url.searchParams.get('options')).toBe('-c TimeZone=UTC');
    expect(url.searchParams.get('schema')).toBe('public');
    expect(url.searchParams.get('connection_limit')).toBe('5');
    expect(url.password).toBe('secret');
  });

  it('keeps other startup options and replaces any caller time zone', () => {
    const url = new URL(
      withUtcSessionTimeZone(
        `postgresql://app@127.0.0.1/hsk_test?options=${encodeURIComponent(
          '-c statement_timeout=30000ms -c TimeZone=Asia/Ho_Chi_Minh --timezone=PST8PDT',
        )}`,
      ),
    );

    expect(url.searchParams.getAll('options')).toEqual([
      '-c statement_timeout=30000ms -c TimeZone=UTC',
    ]);
  });

  it.each([
    [null, '-c TimeZone=UTC'],
    ['', '-c TimeZone=UTC'],
    ['-c time_zone=UTC', '-c TimeZone=UTC'],
    [
      '-ctimezone=Europe/Paris -c lock_timeout=2s',
      '-c lock_timeout=2s -c TimeZone=UTC',
    ],
  ])('normalizes options %p', (options, expected) => {
    expect(pinUtcSessionOptions(options)).toBe(expected);
  });

  it('is idempotent', () => {
    const once = withUtcSessionTimeZone('postgresql://app@localhost/hsk');
    expect(withUtcSessionTimeZone(once)).toBe(once);
  });

  it.each(['not a url', 'mysql://app@localhost/hsk'])(
    'rejects %p without echoing the value',
    (value) => {
      expect(() => withUtcSessionTimeZone(value)).toThrow(
        'DATABASE_URL must be a valid PostgreSQL URL.',
      );
    },
  );
});
