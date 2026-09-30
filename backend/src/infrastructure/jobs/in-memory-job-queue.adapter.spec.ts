import { InMemoryJobQueue } from './in-memory-job-queue.adapter';
import { JOB_NAMES } from './job-queue.port';

describe('InMemoryJobQueue', () => {
  it('should return job id on send', async () => {
    const queue = new InMemoryJobQueue();
    const id = await queue.send(JOB_NAMES.PURGE_EXPIRED_SESSIONS, null);
    expect(id).toBeDefined();
    expect(typeof id).toBe('string');
  });

  it('should return null when singletonKey matches', async () => {
    const queue = new InMemoryJobQueue();
    const id1 = await queue.send(JOB_NAMES.PURGE_EXPIRED_SESSIONS, null, {
      singletonKey: 'key1',
    });
    expect(id1).toBeDefined();

    const id2 = await queue.send(JOB_NAMES.PURGE_EXPIRED_SESSIONS, null, {
      singletonKey: 'key1',
    });
    expect(id2).toBeNull();
  });
});
