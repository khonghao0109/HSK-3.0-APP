import {
  JobQueuePort,
  JobName,
  JobDataMap,
  SendJobOptions,
} from './job-queue.port';

export class InMemoryJobQueue implements JobQueuePort {
  private readonly sentJobs = new Map<string, unknown>();

  send<T extends JobName>(
    name: T,
    data: JobDataMap[T],
    options?: SendJobOptions,
  ): Promise<string | null> {
    const singletonKey = options?.singletonKey;
    if (singletonKey && this.sentJobs.has(singletonKey)) {
      return Promise.resolve(null);
    }

    const id = Math.random().toString(36).slice(2);
    if (singletonKey) {
      this.sentJobs.set(singletonKey, data);
    }
    return Promise.resolve(id);
  }
}
