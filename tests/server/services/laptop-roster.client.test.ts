/**
 * Unit tests for LaptopRosterClient (sprint 002 T002) against an injected
 * fake S3Client ({ send: vi.fn() }, as in backup.service.test.ts), plus the
 * in-memory FakeLaptopRosterClient that later tickets build on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import {
  LaptopRosterClient,
  UnconfiguredLaptopRosterClient,
  LaptopRosterNotConfiguredError,
  rosterConfigKey,
  DEFAULT_LAPTOP_ROSTER_BUCKET,
  type RosterEntry,
} from '../../../server/src/services/laptop/laptop-roster.client.js';
import { InvalidRosterIdError } from '../../../server/src/services/laptop/roster-ids.js';
import { buildS3Client } from '../../../server/src/services/spaces/s3-client.js';
import { getConfig } from '../../../server/src/services/config.js';
import { FakeLaptopRosterClient } from '../helpers/fake-laptop-roster.client.js';

const BUCKET = 'test-roster-bucket';

const sendMock = vi.fn();
const fakeS3 = { send: sendMock } as any;

function entry(id: string, extra: Partial<RosterEntry> = {}): RosterEntry {
  return {
    id,
    display_name: id[0].toUpperCase() + id.slice(1),
    password_hash: '$6$rounds=5000$saltsalt$hashhashhash',
    created: '20260825T170542Z',
    created_host: 'jtl-inspiron-ABC123',
    ...extra,
  };
}

function s3Body(text: string) {
  return { Body: { transformToString: async () => text } };
}

function notFoundError(name = 'NoSuchKey', status = 404) {
  const err = new Error(name) as any;
  err.name = name;
  err.$metadata = { httpStatusCode: status };
  return err;
}

describe('LaptopRosterClient', () => {
  let client: LaptopRosterClient;

  beforeEach(() => {
    sendMock.mockReset();
    client = new LaptopRosterClient({ bucket: BUCKET, s3Client: fakeS3 });
  });

  describe('constructor', () => {
    it('requires a bucket name', () => {
      expect(() => new LaptopRosterClient({ bucket: '', s3Client: fakeS3 })).toThrow(/bucket/);
    });

    it('throws LaptopRosterNotConfiguredError when no client is injected and env is unset', () => {
      const saved = { ...process.env };
      delete process.env.DO_SPACES_ENDPOINT;
      delete process.env.DO_SPACES_KEY;
      delete process.env.DO_SPACES_SECRET;
      try {
        expect(() => new LaptopRosterClient({ bucket: BUCKET })).toThrow(LaptopRosterNotConfiguredError);
      } finally {
        process.env = saved;
      }
    });
  });

  describe('listIds', () => {
    it('lists students/ with a delimiter and returns the id segments', async () => {
      sendMock.mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: 'students/alice/' }, { Prefix: 'students/bob-2/' }],
        IsTruncated: false,
      });

      const ids = await client.listIds();

      expect(ids).toEqual(['alice', 'bob-2']);
      expect(sendMock).toHaveBeenCalledTimes(1);
      const cmd = sendMock.mock.calls[0][0];
      expect(cmd).toBeInstanceOf(ListObjectsV2Command);
      expect(cmd.input).toMatchObject({ Bucket: BUCKET, Prefix: 'students/', Delimiter: '/' });
      expect(cmd.input.ContinuationToken).toBeUndefined();
    });

    it('follows continuation tokens across pages', async () => {
      sendMock
        .mockResolvedValueOnce({
          CommonPrefixes: [{ Prefix: 'students/a01/' }],
          IsTruncated: true,
          NextContinuationToken: 'tok-1',
        })
        .mockResolvedValueOnce({
          CommonPrefixes: [{ Prefix: 'students/b02/' }],
          IsTruncated: true,
          NextContinuationToken: 'tok-2',
        })
        .mockResolvedValueOnce({
          CommonPrefixes: [{ Prefix: 'students/c03/' }],
          IsTruncated: false,
        });

      const ids = await client.listIds();

      expect(ids).toEqual(['a01', 'b02', 'c03']);
      expect(sendMock).toHaveBeenCalledTimes(3);
      expect(sendMock.mock.calls[1][0].input.ContinuationToken).toBe('tok-1');
      expect(sendMock.mock.calls[2][0].input.ContinuationToken).toBe('tok-2');
    });

    it('returns malformed and reserved ids unfiltered so the importer can report them', async () => {
      sendMock.mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: 'students/root/' }, { Prefix: 'students/Bad Name/' }],
        IsTruncated: false,
      });
      expect(await client.listIds()).toEqual(['root', 'Bad Name']);
    });

    it('returns [] for an empty bucket', async () => {
      sendMock.mockResolvedValueOnce({ IsTruncated: false });
      expect(await client.listIds()).toEqual([]);
    });
  });

  describe('read', () => {
    it('GETs students/<id>/config.json and parses the JSON', async () => {
      const e = entry('alice', { managed_by: 'student-accounts' });
      sendMock.mockResolvedValueOnce(s3Body(JSON.stringify(e)));

      const result = await client.read('alice');

      expect(result).toEqual(e);
      const cmd = sendMock.mock.calls[0][0];
      expect(cmd).toBeInstanceOf(GetObjectCommand);
      expect(cmd.input).toEqual({ Bucket: BUCKET, Key: 'students/alice/config.json' });
    });

    it('returns null on NoSuchKey', async () => {
      sendMock.mockRejectedValueOnce(notFoundError('NoSuchKey'));
      expect(await client.read('ghost')).toBeNull();
    });

    it('returns null on a 404 with another name', async () => {
      sendMock.mockRejectedValueOnce(notFoundError('NotFound'));
      expect(await client.read('ghost')).toBeNull();
    });

    it('rethrows other S3 errors', async () => {
      sendMock.mockRejectedValueOnce(notFoundError('AccessDenied', 403));
      await expect(client.read('alice')).rejects.toThrow('AccessDenied');
    });

    it('throws a clear error when the object is not JSON', async () => {
      sendMock.mockResolvedValueOnce(s3Body('not json'));
      await expect(client.read('alice')).rejects.toThrow(/students\/alice\/config\.json is not valid JSON/);
    });

    it('rejects an invalid id before touching S3', async () => {
      await expect(client.read('../secrets')).rejects.toThrow(InvalidRosterIdError);
      await expect(client.read('root')).rejects.toThrow(InvalidRosterIdError);
      expect(sendMock).not.toHaveBeenCalled();
    });
  });

  describe('write', () => {
    it('PUTs 1-space indented JSON as private application/json', async () => {
      sendMock.mockResolvedValueOnce({});
      const e = entry('alice', { updated: '20261018T010203Z' });

      await client.write('alice', e);

      expect(sendMock).toHaveBeenCalledTimes(1);
      const cmd = sendMock.mock.calls[0][0];
      expect(cmd).toBeInstanceOf(PutObjectCommand);
      expect(cmd.input.Bucket).toBe(BUCKET);
      expect(cmd.input.Key).toBe('students/alice/config.json');
      expect(cmd.input.ContentType).toBe('application/json');
      expect(cmd.input.ACL).toBe('private');
      // Same shape league-helper writes: json.dump(entry, indent=1).
      expect(cmd.input.Body).toBe(JSON.stringify(e, null, 1));
      expect(cmd.input.Body).toContain('\n "id": "alice",\n');
      expect(JSON.parse(cmd.input.Body)).toEqual(e);
    });

    it('rejects an invalid id before touching S3', async () => {
      await expect(client.write('a/b', entry('a/b'))).rejects.toThrow(InvalidRosterIdError);
      await expect(client.write('ubuntu', entry('ubuntu'))).rejects.toThrow(InvalidRosterIdError);
      expect(sendMock).not.toHaveBeenCalled();
    });

    it('propagates S3 failures', async () => {
      sendMock.mockRejectedValueOnce(new Error('ServiceUnavailable'));
      await expect(client.write('alice', entry('alice'))).rejects.toThrow('ServiceUnavailable');
    });
  });
});

describe('rosterConfigKey', () => {
  it('builds the key under students/', () => {
    expect(rosterConfigKey('alice')).toBe('students/alice/config.json');
  });
  it('throws for ids that could escape the prefix', () => {
    expect(() => rosterConfigKey('../x')).toThrow(InvalidRosterIdError);
  });
});

describe('UnconfiguredLaptopRosterClient', () => {
  it('throws LaptopRosterNotConfiguredError from every method', async () => {
    const stub = new UnconfiguredLaptopRosterClient();
    await expect(stub.listIds()).rejects.toThrow(LaptopRosterNotConfiguredError);
    await expect(stub.read('alice')).rejects.toThrow(/not configured/);
    await expect(stub.write('alice', entry('alice'))).rejects.toThrow(/DO_SPACES_KEY/);
  });
});

describe('buildS3Client', () => {
  const VARS = ['DO_SPACES_ENDPOINT', 'DO_SPACES_KEY', 'DO_SPACES_SECRET', 'DO_SPACES_REGION'];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of VARS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('returns null when endpoint, key or secret is missing', () => {
    expect(buildS3Client()).toBeNull();
    process.env.DO_SPACES_ENDPOINT = 'https://sfo3.digitaloceanspaces.com';
    process.env.DO_SPACES_KEY = 'AKIATEST';
    expect(buildS3Client()).toBeNull();
  });

  it('builds a client from env with region defaulting to sfo3', async () => {
    process.env.DO_SPACES_ENDPOINT = 'https://sfo3.digitaloceanspaces.com';
    process.env.DO_SPACES_KEY = 'AKIATEST';
    process.env.DO_SPACES_SECRET = 'secret';
    const client = buildS3Client();
    expect(client).not.toBeNull();
    expect(await client!.config.region()).toBe('sfo3');
    expect(client!.config.forcePathStyle).toBe(false);
    client!.destroy();
  });

  it('prefers explicit options over env', async () => {
    process.env.DO_SPACES_REGION = 'nyc3';
    const client = buildS3Client({
      endpoint: 'https://example.com',
      key: 'k',
      secret: 's',
      region: 'ams3',
    });
    expect(await client!.config.region()).toBe('ams3');
    client!.destroy();
  });
});

describe('LAPTOP_ROSTER_BUCKET config default', () => {
  it('getConfig falls back to the roster bucket default', () => {
    const saved = process.env.LAPTOP_ROSTER_BUCKET;
    delete process.env.LAPTOP_ROSTER_BUCKET;
    try {
      expect(getConfig('LAPTOP_ROSTER_BUCKET')).toBe(DEFAULT_LAPTOP_ROSTER_BUCKET);
      expect(getConfig('LAPTOP_ROSTER_BUCKET')).toBe('jtl-student-unix-accounts');
    } finally {
      if (saved !== undefined) process.env.LAPTOP_ROSTER_BUCKET = saved;
    }
  });
});

describe('FakeLaptopRosterClient', () => {
  it('seeds, lists sorted, reads copies and records writes', async () => {
    const fake = new FakeLaptopRosterClient().seed(entry('bob'), entry('alice'));

    expect(await fake.listIds()).toEqual(['alice', 'bob']);
    const read = await fake.read('alice');
    expect(read).toEqual(entry('alice'));
    read!.display_name = 'mutated';
    expect((await fake.read('alice'))!.display_name).toBe('Alice');
    expect(await fake.read('nobody-here')).toBeNull();

    await fake.write('carol', entry('carol'));
    expect(fake.writes).toEqual([{ id: 'carol', entry: entry('carol') }]);
    expect(await fake.listIds()).toEqual(['alice', 'bob', 'carol']);
  });

  it('failWrites rejects and leaves state unchanged, but still records the attempt', async () => {
    const fake = new FakeLaptopRosterClient().seed(entry('alice'));
    fake.failWrites = true;

    await expect(fake.write('alice', entry('alice', { password_hash: '!' }))).rejects.toThrow(/writes failing/);
    expect((await fake.read('alice'))!.password_hash).not.toBe('!');
    expect(fake.writes).toHaveLength(1);

    fake.reset();
    expect(await fake.listIds()).toEqual([]);
    expect(fake.writes).toHaveLength(0);
    expect(fake.failWrites).toBe(false);
  });
});
