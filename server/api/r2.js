import { createR2S3Client, R2_VIDEOS_PREFIX } from './lib/r2Client.mjs';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;

export { R2_VIDEOS_PREFIX };

export const hasR2 = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY);

export const s3 = createR2S3Client({
  accountId: R2_ACCOUNT_ID,
  accessKey: R2_ACCESS_KEY,
  secretKey: R2_SECRET_KEY
});
