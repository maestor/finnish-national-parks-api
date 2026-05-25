import type { StorageClient } from './types.js';

export const createMemoryStorage = (): StorageClient & { getStore(): Map<string, Buffer> } => {
  const store = new Map<string, Buffer>();
  const metadataStore = new Map<string, { contentLength: number; contentType: string }>();

  return {
    delete: async (key: string) => {
      store.delete(key);
      metadataStore.delete(key);
    },
    getObjectMetadata: async (key: string) => {
      const metadata = metadataStore.get(key);
      if (!metadata) {
        return null;
      }

      return metadata;
    },
    getPresignedUrl: async (key: string) => {
      return `https://memory-storage.test/${key}`;
    },
    getPresignedUploadUrl: async (key: string) => {
      return `https://memory-storage-upload.test/${key}`;
    },
    getStore: () => store,
    upload: async (key: string, buffer: Buffer, contentType: string) => {
      store.set(key, buffer);
      metadataStore.set(key, {
        contentLength: buffer.length,
        contentType
      });
    }
  };
};
