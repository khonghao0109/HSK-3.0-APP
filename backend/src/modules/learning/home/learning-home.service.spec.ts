import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { LearningHomeService } from './learning-home.service';

const NOW = new Date('2026-10-07T05:00:00Z');
const UNKNOWN_ZONE = 'US/Pacific-New';
const DEFAULT_ZONE = 'Asia/Ho_Chi_Minh';

function rawQueryError(pgCode: string) {
  return new Prisma.PrismaClientKnownRequestError(
    `Raw query failed. Code: \`${pgCode}\`.`,
    { code: 'P2010', clientVersion: '5', meta: { code: pgCode } },
  );
}

/** Values bound into a tagged-template `$queryRaw` call. */
type RawCall = [TemplateStringsArray, ...unknown[]];

/** The IANA zone bound into a day query (the only string value with `/`). */
function zonesIn(values: unknown[]): string[] {
  return values.filter(
    (value): value is string =>
      typeof value === 'string' && value.includes('/'),
  );
}

function setup(timezone: string, fail: (tz: string) => Error | null) {
  const queryRaw = jest.fn(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const error = fail(zonesIn(values)[0]);
      if (error) return Promise.reject(error);
      return Promise.resolve(
        strings.join('').includes('"todayLocal"')
          ? [{ todayLocal: '2026-10-07', minutesToday: 2 }]
          : [],
      );
    },
  );
  const prisma = {
    $queryRaw: queryRaw,
    user: {
      findUnique: jest.fn().mockResolvedValue({
        name: 'Lan',
        profile: { displayName: null, timezone },
      }),
    },
  };
  const path = {
    loadPathState: jest.fn().mockResolvedValue({
      nextStep: 'ready',
      goal: {
        dailyMinutes: 15,
        targetLevel: { code: 'HSK1', orderIndex: 1 },
      },
      pathLevels: [],
    }),
  };
  const service = new LearningHomeService(prisma as never, path as never);
  const zonesOf = () =>
    (queryRaw.mock.calls as RawCall[]).map(([, ...values]) => zonesIn(values));
  return { service, queryRaw, zonesOf };
}

describe('LearningHomeService timezone fallback', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('[U1] reruns both day queries with the default timezone after 22023', async () => {
    const { service, queryRaw, zonesOf } = setup(UNKNOWN_ZONE, (tz) =>
      tz === UNKNOWN_ZONE ? rawQueryError('22023') : null,
    );

    const warn = jest.spyOn(Logger.prototype, 'warn');

    const result = await service.getHome(1, NOW);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`userId=1, tz=${UNKNOWN_ZONE}`),
    );

    expect(result.data.dailyGoal).toEqual({
      targetMinutes: 15,
      minutesToday: 2,
    });
    expect(queryRaw).toHaveBeenCalledTimes(4);
    const zones = zonesOf();
    expect(
      zones
        .slice(0, 2)
        .flat()
        .every((tz) => tz === UNKNOWN_ZONE),
    ).toBe(true);
    expect(zones[2].length).toBeGreaterThan(0);
    expect(zones[3].length).toBeGreaterThan(0);
    expect(
      zones
        .slice(2)
        .flat()
        .every((tz) => tz === DEFAULT_ZONE),
    ).toBe(true);
  });

  it('[U2] rethrows a P2010 error with another PostgreSQL code', async () => {
    const error = rawQueryError('42P01');
    const { service } = setup(UNKNOWN_ZONE, (tz) =>
      tz === UNKNOWN_ZONE ? error : null,
    );

    await expect(service.getHome(1, NOW)).rejects.toBe(error);
  });

  it('[U3] rethrows 22023 when the timezone already is the default', async () => {
    const error = rawQueryError('22023');
    const { service, queryRaw } = setup(DEFAULT_ZONE, () => error);

    await expect(service.getHome(1, NOW)).rejects.toBe(error);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it('[U4] rethrows an error that does not come from Prisma', async () => {
    const error = new Error('connection reset');
    const { service } = setup(UNKNOWN_ZONE, (tz) =>
      tz === UNKNOWN_ZONE ? error : null,
    );

    await expect(service.getHome(1, NOW)).rejects.toBe(error);
  });
});
