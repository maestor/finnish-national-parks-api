import type { StorageClient } from './types.js';

export const createMemoryStorage = (): StorageClient & { getStore(): Map<string, Buffer> } => {
  const store = new Map<string, Buffer>();

  return {
    delete: async (key: string) => {
      store.delete(key);
    },
    getPresignedUrl: async (key: string) => {
      return `https://memory-storage.test/${key}`;
    },
    getStore: () => store,
    upload: async (key: string, buffer: Buffer) => {
      store.set(key, buffer);
    }
  };
};
