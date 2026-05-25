export type StoredObjectMetadata = {
  contentLength: number | null;
  contentType: string | null;
};

export interface StorageClient {
  upload(key: string, buffer: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  getPresignedUrl(key: string, expiresInSeconds: number): Promise<string>;
  getPresignedUploadUrl(
    key: string,
    contentType: string,
    expiresInSeconds: number
  ): Promise<string>;
  getObjectMetadata(key: string): Promise<StoredObjectMetadata | null>;
}
