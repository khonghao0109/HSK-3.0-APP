import { Injectable } from '@nestjs/common';

import {
  ObjectStoragePort,
  ObjectStorageWriteError,
  StoredObject,
} from './object-storage.port';

@Injectable()
export class InMemoryObjectStorageAdapter implements ObjectStoragePort {
  readonly provider = 'memory-test';
  private readonly objects = new Map<string, StoredObject>();
  private nextPutFailure = false;
  private nextPutFailureAfterWrite = false;
  private nextDeleteFailure = false;
  private nextDeleteBarrier:
    | {
        started: () => void;
        release: Promise<void>;
      }
    | undefined;

  putPrivateObject(input: {
    key: string;
    body: Buffer;
    contentType: string;
    checksum: string;
  }): Promise<void> {
    if (this.nextPutFailure) {
      this.nextPutFailure = false;
      return Promise.reject(
        new ObjectStorageWriteError('definite_not_written'),
      );
    }
    this.objects.set(input.key, {
      body: Buffer.from(input.body),
      contentType: input.contentType,
      checksum: input.checksum,
      size: input.body.length,
    });
    if (this.nextPutFailureAfterWrite) {
      this.nextPutFailureAfterWrite = false;
      return Promise.reject(new ObjectStorageWriteError('unknown'));
    }
    return Promise.resolve();
  }

  getPrivateObject(key: string): Promise<StoredObject> {
    const object = this.objects.get(key);
    if (!object) return Promise.reject(new Error('Storage object not found.'));
    return Promise.resolve({ ...object, body: Buffer.from(object.body) });
  }

  async deletePrivateObject(key: string): Promise<void> {
    if (this.nextDeleteFailure) {
      this.nextDeleteFailure = false;
      throw new Error('Synthetic storage delete failure.');
    }
    if (this.nextDeleteBarrier) {
      const barrier = this.nextDeleteBarrier;
      this.nextDeleteBarrier = undefined;
      barrier.started();
      await barrier.release;
    }
    this.objects.delete(key);
  }

  count(): number {
    return this.objects.size;
  }

  failNextPut(): void {
    this.nextPutFailure = true;
  }

  failNextPutAfterWrite(): void {
    this.nextPutFailureAfterWrite = true;
  }

  failNextDelete(): void {
    this.nextDeleteFailure = true;
  }

  blockNextDelete(): { started: Promise<void>; release: () => void } {
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.nextDeleteBarrier = { started: markStarted, release: releasePromise };
    return { started, release };
  }
}
