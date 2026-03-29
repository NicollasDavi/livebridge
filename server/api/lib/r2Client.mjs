import { S3Client } from '@aws-sdk/client-s3';

export const R2_VIDEOS_PREFIX = 'recordings/videos/';

export function createR2S3Client({ accountId, accessKey, secretKey }) {
  if (!accountId || !accessKey || !secretKey) return null;
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey }
  });
}
