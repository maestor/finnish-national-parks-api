export interface StorageClient {
  upload(key: string, buffer: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  getPublicUrl(key: string): string;
}
