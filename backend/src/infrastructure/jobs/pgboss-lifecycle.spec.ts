import { PgBossLifecycle } from './pgboss-lifecycle';
import type { PgBoss } from 'pg-boss' with { 'resolution-mode': 'import' };

describe('PgBossLifecycle', () => {
  it('calls boss.stop exactly once when boss is present', async () => {
    const mockBoss: Pick<PgBoss, 'stop'> = {
      stop: jest.fn().mockResolvedValue(undefined),
    };

    const lifecycle = new PgBossLifecycle(mockBoss as never);
    await lifecycle.onApplicationShutdown();

    expect(mockBoss.stop).toHaveBeenCalledTimes(1);
    expect(mockBoss.stop).toHaveBeenCalledWith({
      graceful: true,
      timeout: 30000,
    });
  });

  it('does not throw when boss is null', async () => {
    const lifecycle = new PgBossLifecycle(null);
    await expect(lifecycle.onApplicationShutdown()).resolves.toBeUndefined();
  });
});
