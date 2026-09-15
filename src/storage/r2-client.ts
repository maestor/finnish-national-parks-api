import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import {
  type StorageClient,
  StorageObjectTooLargeError,
  type StorageReadOptions
} from './types.js';

export type R2Config = {
  accessKeyId: string;
  bucketName: string;
  client?: S3Client;
  endpoint: string;
  secretAccessKey: string;
};

const DEFAULT_STORAGE_READ_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_STORAGE_READ_TIMEOUT_MS = 10_000;

const readBodyWithLimit = async (
  body: { transformToWebStream: () => ReadableStream<Uint8Array> },
  {
    maxBytes = DEFAULT_STORAGE_READ_MAX_BYTES,
    timeoutMs = DEFAULT_STORAGE_READ_TIMEOUT_MS
  }: StorageReadOptions = {}
) => {
  const reader = body.transformToWebStream().getReader();
  const chunks: Uint8Array[] = [];
  const deadline = Date.now() + timeoutMs;
  let totalBytes = 0;

  try {
    while (true) {
      const remainingMs = deadline - Date.now();

      if (remainingMs <= 0) {
        await reader.cancel('Storage read timed out.');
        throw new Error('Storage read timed out.');
      }

      let timeout: ReturnType<typeof setTimeout> | undefined;
      const read = reader.read();
      const timedOut = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Storage read timed out.')), remainingMs);
      });

      try {
        const { done, value } = await Promise.race([read, timedOut]);

        if (done) {
          break;
        }

        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel('Stored object is too large.');
          throw new StorageObjectTooLargeError();
        }

        chunks.push(value);
      } catch (error) {
        await reader.cancel(error instanceof Error ? error.message : 'Storage read failed.');
        throw error;
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }
    }
  } catch (error) {
    await reader.cancel(error instanceof Error ? error.message : 'Storage read failed.');
    throw error;
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
};

export const createR2Client = (config: R2Config): StorageClient => {
  const s3 =
    config.client ??
    new S3Client({
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      },
      endpoint: config.endpoint,
      forcePathStyle: true,
      region: 'auto'
    });

  return {
    delete: async (key: string) => {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: config.bucketName,
          Key: key
        })
      );
    },
    getObjectMetadata: async (key: string) => {
      try {
        const response = await s3.send(
          new HeadObjectCommand({
            Bucket: config.bucketName,
            Key: key
          })
        );

        return {
          contentLength: response.ContentLength ?? null,
          contentType: response.ContentType ?? null
        };
      } catch (error) {
        const errorName = (error as { name?: string }).name;
        if (errorName === 'NotFound' || errorName === 'NoSuchKey') {
          return null;
        }

        throw error;
      }
    },
    getObject: async (key: string, options) => {
      try {
        const response = await s3.send(
          new GetObjectCommand({
            Bucket: config.bucketName,
            Key: key
          })
        );

        if (!response.Body) {
          return null;
        }

        if (
          response.ContentLength !== undefined &&
          options?.maxBytes !== undefined &&
          response.ContentLength > options.maxBytes
        ) {
          throw new StorageObjectTooLargeError();
        }

        return readBodyWithLimit(response.Body, options);
      } catch (error) {
        const errorName = (error as { name?: string }).name;
        if (errorName === 'NotFound' || errorName === 'NoSuchKey') {
          return null;
        }

        throw error;
      }
    },
    getPresignedUrl: async (key: string, expiresInSeconds: number) => {
      return getSignedUrl(s3, new GetObjectCommand({ Bucket: config.bucketName, Key: key }), {
        expiresIn: expiresInSeconds
      });
    },
    getPresignedUploadUrl: async (key: string, contentType: string, expiresInSeconds: number) => {
      return getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: config.bucketName,
          ContentType: contentType,
          Key: key
        }),
        {
          expiresIn: expiresInSeconds
        }
      );
    },
    listObjects: async ({ cursor, limit, prefix }) => {
      const response = await s3.send(
        new ListObjectsV2Command({
          Bucket: config.bucketName,
          ContinuationToken: cursor,
          MaxKeys: limit,
          Prefix: prefix
        })
      );

      return {
        items: (response.Contents ?? []).flatMap((object) => {
          if (!object.Key) {
            return [];
          }

          return [
            {
              key: object.Key,
              lastModified: object.LastModified ?? null,
              size: object.Size ?? null
            }
          ];
        }),
        nextCursor: response.NextContinuationToken ?? null
      };
    },
    upload: async (key: string, buffer: Buffer, contentType: string) => {
      await s3.send(
        new PutObjectCommand({
          Body: buffer,
          Bucket: config.bucketName,
          ContentType: contentType,
          Key: key
        })
      );
    }
  };
};
