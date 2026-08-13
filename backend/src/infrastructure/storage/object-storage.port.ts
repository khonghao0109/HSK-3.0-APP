export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
export const MAX_PRIVATE_MEDIA_OBJECT_BYTES = 10 * 1024 * 1024;

export type StoredObject = {
  body: Buffer;
  contentType: string;
  checksum: string;
  size: number;
};

export type ObjectStorageWriteOutcome = 'definite_not_written' | 'unknown';

export class ObjectStorageWriteError extends Error {
  constructor(readonly outcome: ObjectStorageWriteOutcome) {
    super('Private object storage write failed.');
    this.name = 'ObjectStorageWriteError';
  }
}

export interface ObjectStoragePort {
  readonly provider: string;
  putPrivateObject(input: {
    key: string;
    body: Buffer;
    contentType: string;
    checksum: string;
  }): Promise<void>;
  privateObjectExists(key: string): Promise<boolean>;
  getPrivateObject(key: string): Promise<StoredObject>;
  deletePrivateObject(key: string): Promise<void>;
}
