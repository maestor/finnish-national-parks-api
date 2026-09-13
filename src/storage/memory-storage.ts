import type { StorageClient } from './types.js';

export const createMemoryStorage = (): StorageClient & { getStore(): Map<string, Buffer> } => {
  const store = new Map<string, Buffer>();
  const metadataStore = new Map<
    string,
    { contentLength: number; contentType: string; lastModified: Date }
  >();

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

      return {
        contentLength: metadata.contentLength,
        contentType: metadata.contentType
      };
    },
    getObject: async (key: string) => {
      const object = store.get(key);
      return object ? Buffer.from(object) : null;
    },
    getPresignedUrl: async (key: string) => {
      return `https://memory-storage.test/${key}`;
    },
    getPresignedUploadUrl: async (key: string) => {
      return `https://memory-storage-upload.test/${key}`;
    },
    getStore: () => store,
    listObjects: async ({ cursor, limit, prefix }) => {
      const keys = Array.from(store.keys())
        .filter((key) => key.startsWith(prefix))
        .sort();
      const startIndex = cursor ? keys.indexOf(cursor) + 1 : 0;
      const pageKeys = keys.slice(startIndex, startIndex + limit);

      return {
        items: pageKeys.map((key) => {
          const metadata = metadataStore.get(key);
          return {
            key,
            lastModified: metadata?.lastModified ?? null,
            size: metadata?.contentLength ?? null
          };
        }),
        nextCursor: startIndex + limit < keys.length ? (pageKeys.at(-1) ?? null) : null
      };
    },
    upload: async (key: string, buffer: Buffer, contentType: string) => {
      store.set(key, buffer);
      metadataStore.set(key, {
        contentLength: buffer.length,
        contentType,
        lastModified: new Date()
      });
    }
  };
};
