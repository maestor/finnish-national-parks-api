export interface StorageClient {
  upload(key: string, buffer: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  getPresignedUrl(key: string, expiresInSeconds: number): Promise<string>;
}
