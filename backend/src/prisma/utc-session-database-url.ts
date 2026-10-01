// Timestamp columns are `timestamp(3)` without time zone, so casts such as
// `clock_timestamp()::timestamp(3)` in triggers and migrations follow the
// session TimeZone. The server default is not trusted (a local cluster may run
// in Asia/Ho_Chi_Minh), so every application session is pinned to UTC through
// the libpq `options` startup parameter.
const TIME_ZONE_OPTION = /(?:^|\s)(?:-c\s*|--)time_?zone=\S+/giu;

export const UTC_SESSION_OPTION = '-c TimeZone=UTC';

export function pinUtcSessionOptions(options: string | null): string {
  const withoutTimeZone = (options ?? '')
    .replace(TIME_ZONE_OPTION, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return withoutTimeZone
    ? `${withoutTimeZone} ${UTC_SESSION_OPTION}`
    : UTC_SESSION_OPTION;
}

export function withUtcSessionTimeZone(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');
  }
  parsed.searchParams.set(
    'options',
    pinUtcSessionOptions(parsed.searchParams.get('options')),
  );
  return parsed.toString();
}
