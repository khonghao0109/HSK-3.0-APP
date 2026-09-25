/// <reference types="jest" />

import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

type SessionClock = {
  timeZone: string;
  clockDriftMs: number;
};

async function readSessionClock(prisma: PrismaService): Promise<SessionClock> {
  const before = Date.now();
  const [row] = await prisma.$queryRaw<
    Array<{ timeZone: string; localNow: Date }>
  >`
    SELECT
      current_setting('TimeZone') AS "timeZone",
      clock_timestamp()::timestamp(3) AS "localNow"
  `;
  const after = Date.now();
  // Prisma reads timestamp without time zone as UTC wall time.
  const localNow = row.localNow.getTime();
  const clockDriftMs =
    localNow < before ? before - localNow : Math.max(0, localNow - after);
  return { timeZone: row.timeZone, clockDriftMs };
}

describe('Database session time zone (C-05)', () => {
  const clients: PrismaService[] = [];

  beforeAll(() => {
    assertDisposableTestDatabase();
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.$disconnect()));
  });

  it('pins the application Prisma session to UTC', async () => {
    const prisma = new PrismaService();
    clients.push(prisma);

    const clock = await readSessionClock(prisma);

    expect(clock.timeZone).toBe('UTC');
    expect(clock.clockDriftMs).toBeLessThan(60_000);
  });

  it('overrides a non-UTC TimeZone supplied through the connection URL', async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    url.searchParams.set(
      'options',
      '-c statement_timeout=30000ms -c TimeZone=Asia/Ho_Chi_Minh',
    );
    const prisma = new PrismaService({
      datasources: { db: { url: url.toString() } },
    });
    clients.push(prisma);

    const clock = await readSessionClock(prisma);
    const [{ statementTimeout }] = await prisma.$queryRaw<
      Array<{ statementTimeout: string }>
    >`SELECT current_setting('statement_timeout') AS "statementTimeout"`;

    expect(clock.timeZone).toBe('UTC');
    expect(clock.clockDriftMs).toBeLessThan(60_000);
    expect(statementTimeout).toBe('30s');
  });
});
