export type StoredObjectMetadata = {
  contentLength: number | null;
  contentType: string | null;
};

export type StoredObject = {
  key: string;
  lastModified: Date | null;
  size: number | null;
};

export type StoredObjectPage = {
  items: StoredObject[];
  nextCursor: string | null;
};

export type StorageReadOptions = {
  maxBytes?: number | undefined;
  timeoutMs?: number | undefined;
};

export class StorageObjectTooLargeError extends Error {
  constructor() {
    super('Stored object exceeds the configured read limit.');
  }
}

export interface StorageClient {
  upload(key: string, buffer: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  getObject(key: string, options?: StorageReadOptions): Promise<Buffer | null>;
  getPresignedUrl(key: string, expiresInSeconds: number): Promise<string>;
  getPresignedUploadUrl(
    key: string,
    contentType: string,
    expiresInSeconds: number
  ): Promise<string>;
  getObjectMetadata(key: string): Promise<StoredObjectMetadata | null>;
  listObjects(input: { cursor?: string; limit: number; prefix: string }): Promise<StoredObjectPage>;
}
