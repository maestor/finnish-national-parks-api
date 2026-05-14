import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { StorageClient } from './types.js';

export type R2Config = {
  accessKeyId: string;
  bucketName: string;
  endpoint: string;
  publicUrl: string;
  secretAccessKey: string;
};

export const createR2Client = (config: R2Config): StorageClient => {
  const s3 = new S3Client({
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
    getPublicUrl: (key: string) => {
      return `${config.publicUrl}/${key}`;
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
