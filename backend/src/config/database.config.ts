import { withUtcSessionTimeZone } from '../prisma/utc-session-database-url';

export default () => ({
  database: {
    url: process.env.DATABASE_URL
      ? withUtcSessionTimeZone(process.env.DATABASE_URL)
      : undefined,
  },
});
