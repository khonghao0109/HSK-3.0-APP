import { InMemoryJobQueue } from './in-memory-job-queue.adapter';
import { JOB_NAMES } from './job-queue.port';

describe('InMemoryJobQueue', () => {
  let queue: InMemoryJobQueue;

  beforeEach(() => {
    queue = new InMemoryJobQueue();
  });

  it('enqueues jobs and records them in getJobs()', async () => {
    const id = await queue.send(JOB_NAMES.PURGE_EXPIRED_SESSIONS, null);
    expect(typeof id).toBe('string');

    const jobs = queue.getJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe(JOB_NAMES.PURGE_EXPIRED_SESSIONS);
    expect(jobs[0].data).toBeNull();
  });

  it('filters jobs by name in getJobsByName()', async () => {
    await queue.send(JOB_NAMES.PURGE_EXPIRED_SESSIONS, null);

    const purgeJobs = queue.getJobsByName(JOB_NAMES.PURGE_EXPIRED_SESSIONS);
    expect(purgeJobs).toHaveLength(1);
  });

  it('respects singletonKey and returns null on second enqueue', async () => {
    const first = await queue.send(JOB_NAMES.PURGE_EXPIRED_SESSIONS, null, {
      singletonKey: 'singleton-1',
    });
    expect(first).not.toBeNull();

    const second = await queue.send(JOB_NAMES.PURGE_EXPIRED_SESSIONS, null, {
      singletonKey: 'singleton-1',
    });
    expect(second).toBeNull();

    expect(queue.getJobs()).toHaveLength(1);
  });

  it('clears jobs on clear()', async () => {
    await queue.send(JOB_NAMES.PURGE_EXPIRED_SESSIONS, null);
    expect(queue.getJobs()).toHaveLength(1);

    queue.clear();
    expect(queue.getJobs()).toHaveLength(0);
  });
});
