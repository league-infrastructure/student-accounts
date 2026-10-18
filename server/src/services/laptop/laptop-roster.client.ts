import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { buildS3Client } from '../spaces/s3-client';
import { assertValidRosterId } from './roster-ids';

/** Bucket the laptops have always used; override with LAPTOP_ROSTER_BUCKET. */
export const DEFAULT_LAPTOP_ROSTER_BUCKET = 'jtl-student-unix-accounts';

/** Prefix under which every student's objects live. */
export const ROSTER_PREFIX = 'students/';

/**
 * One `students/<id>/config.json` object, as written by `league-helper` on
 * the laptops and, from this sprint on, by this app.
 *
 * `password_hash` is a SHA-512 crypt (`$6$`) hash, or `!` for a locked
 * account. Timestamps are compact ISO-8601 UTC (`20260825T170542Z`).
 */
export interface RosterEntry {
  id: string;
  display_name: string;
  password_hash: string;
  created: string;
  created_host: string;
  /** Who maintains this entry now, e.g. `student-accounts`. */
  managed_by?: string;
  updated?: string;
  /** Previous id when an entry was moved. */
  renamed_from?: string;
}

/**
 * What the app needs from the roster. `LaptopRosterClient` is the Spaces
 * implementation; tests use `FakeLaptopRosterClient` from tests/server/helpers.
 */
export interface RosterClient {
  /** Every `<id>` that has a `students/<id>/` prefix, unvalidated (callers skip bad ones). */
  listIds(): Promise<string[]>;
  /** The entry for `id`, or null when the object does not exist. */
  read(id: string): Promise<RosterEntry | null>;
  /** Create or replace the entry for `id`. */
  write(id: string, entry: RosterEntry): Promise<void>;
}

export class LaptopRosterNotConfiguredError extends Error {
  constructor() {
    super(
      'Laptop roster is not configured: set DO_SPACES_ENDPOINT, DO_SPACES_KEY and DO_SPACES_SECRET ' +
        '(and optionally LAPTOP_ROSTER_BUCKET) to reach the Spaces bucket.',
    );
    this.name = 'LaptopRosterNotConfiguredError';
  }
}

/** Object key of a student's roster entry. Throws unless `id` is valid. */
export function rosterConfigKey(id: string): string {
  assertValidRosterId(id);
  return `${ROSTER_PREFIX}${id}/config.json`;
}

function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NoSuchKey' || e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404;
}

/**
 * Spaces-backed roster client. Knows the bucket layout and nothing about
 * users. `opts.s3Client` is the test seam, as in BackupService; production
 * code lets it build the client from DO_SPACES_* env.
 */
export class LaptopRosterClient implements RosterClient {
  private readonly bucket: string;
  private readonly s3: S3Client;

  constructor(opts: { bucket: string; s3Client?: S3Client }) {
    if (!opts.bucket) throw new Error('LaptopRosterClient requires a bucket name');
    const s3 = opts.s3Client ?? buildS3Client();
    if (!s3) throw new LaptopRosterNotConfiguredError();
    this.bucket = opts.bucket;
    this.s3 = s3;
  }

  async listIds(): Promise<string[]> {
    const ids: string[] = [];
    let continuationToken: string | undefined;
    do {
      const resp = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: ROSTER_PREFIX,
          Delimiter: '/',
          ContinuationToken: continuationToken,
        }),
      );
      for (const cp of resp.CommonPrefixes ?? []) {
        const prefix = cp.Prefix ?? '';
        if (!prefix.startsWith(ROSTER_PREFIX)) continue;
        const id = prefix.slice(ROSTER_PREFIX.length).replace(/\/$/, '');
        if (id) ids.push(id);
      }
      continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (continuationToken);
    return ids;
  }

  async read(id: string): Promise<RosterEntry | null> {
    const key = rosterConfigKey(id);
    let body: string;
    try {
      const resp = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      body = (await resp.Body?.transformToString()) ?? '';
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
    try {
      return JSON.parse(body) as RosterEntry;
    } catch (err) {
      throw new Error(`Laptop roster entry ${key} is not valid JSON: ${(err as Error).message}`);
    }
  }

  async write(id: string, entry: RosterEntry): Promise<void> {
    const key = rosterConfigKey(id);
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        // league-helper writes json.dump(..., indent=1); match it so diffs
        // between laptop-written and app-written entries stay readable.
        Body: JSON.stringify(entry, null, 1),
        ContentType: 'application/json',
        ACL: 'private',
      }),
    );
  }
}

/**
 * Stands in for the roster when Spaces credentials are absent, so the
 * registry always has a `laptopRoster` and callers get one clear error.
 */
export class UnconfiguredLaptopRosterClient implements RosterClient {
  async listIds(): Promise<string[]> {
    throw new LaptopRosterNotConfiguredError();
  }
  async read(_id: string): Promise<RosterEntry | null> {
    throw new LaptopRosterNotConfiguredError();
  }
  async write(_id: string, _entry: RosterEntry): Promise<void> {
    throw new LaptopRosterNotConfiguredError();
  }
}
