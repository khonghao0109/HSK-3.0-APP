export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
export const MAX_PRIVATE_MEDIA_OBJECT_BYTES = 10 * 1024 * 1024;

export type StoredObject = {
  body: Buffer;
  contentType: string;
  checksum: string;
  size: number;
};

export type ObjectStorageWriteOutcome = 'definite_not_written' | 'unknown';

export type ObjectStorageErrorKind =
  | 'unavailable'
  | 'not_found'
  | 'provider_mismatch'
  | 'malformed_response'
  | 'integrity_violation';

const STORAGE_ERROR_MESSAGES: Record<ObjectStorageErrorKind, string> = {
  unavailable: 'Private object storage is unavailable.',
  not_found: 'Private object was not found.',
  provider_mismatch: 'Private object storage provider mismatch.',
  malformed_response: 'Private object storage response is malformed.',
  integrity_violation: 'Private object integrity validation failed.',
};

export class ObjectStorageError extends Error {
  constructor(readonly kind: ObjectStorageErrorKind) {
    super(STORAGE_ERROR_MESSAGES[kind]);
    this.name = 'ObjectStorageError';
  }
}

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
