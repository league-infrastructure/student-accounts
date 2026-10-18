import { S3Client } from '@aws-sdk/client-s3';

/**
 * Options for buildS3Client. Every field falls back to the matching
 * DO_SPACES_* environment variable, so production code calls
 * `buildS3Client()` and tests can pass explicit values.
 */
export interface BuildS3ClientOptions {
  endpoint?: string;
  key?: string;
  secret?: string;
  region?: string;
}

export const DEFAULT_SPACES_REGION = 'sfo3';

/**
 * Build an S3 client for DigitalOcean Spaces, or null if not configured.
 *
 * Reads DO_SPACES_ENDPOINT, DO_SPACES_KEY, DO_SPACES_SECRET and
 * DO_SPACES_REGION (default `sfo3`). One Spaces client serves every bucket
 * the app touches (backups, laptop roster); the bucket is chosen per call.
 */
export function buildS3Client(opts: BuildS3ClientOptions = {}): S3Client | null {
  const endpoint = opts.endpoint ?? process.env.DO_SPACES_ENDPOINT;
  const key = opts.key ?? process.env.DO_SPACES_KEY;
  const secret = opts.secret ?? process.env.DO_SPACES_SECRET;
  const region = opts.region ?? process.env.DO_SPACES_REGION ?? DEFAULT_SPACES_REGION;

  if (!endpoint || !key || !secret) return null;

  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId: key, secretAccessKey: secret },
    forcePathStyle: false,
  });
}
