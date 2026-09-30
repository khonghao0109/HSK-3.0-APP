import {
  JobQueuePort,
  JobName,
  JobDataMap,
  SendJobOptions,
} from './job-queue.port';

export interface EnqueuedJob<T extends JobName = JobName> {
  id: string;
  name: T;
  data: JobDataMap[T];
  options?: SendJobOptions;
}

export class InMemoryJobQueue implements JobQueuePort {
  private readonly sentJobs = new Map<string, unknown>();
  private readonly enqueued: EnqueuedJob[] = [];

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
    this.enqueued.push({ id, name, data, options });
    return Promise.resolve(id);
  }

  getJobs(): readonly EnqueuedJob[] {
    return [...this.enqueued];
  }

  getJobsByName<T extends JobName>(name: T): readonly EnqueuedJob<T>[] {
    return this.enqueued.filter((j): j is EnqueuedJob<T> => j.name === name);
  }

  clear(): void {
    this.sentJobs.clear();
    this.enqueued.length = 0;
  }
}
