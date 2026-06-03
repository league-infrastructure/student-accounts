import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { BackupService } from '../../server/src/services/backup.service';

// A fake Spaces client whose .send is a spy we control. Injected via the
// BackupService constructor's opts.s3Client seam — no network, no AWS SDK.
const sendMock = vi.fn();
const fakeS3Client = { send: sendMock } as any;

const SPACES_VARS = [
  'DO_SPACES_ENDPOINT',
  'DO_SPACES_KEY',
  'DO_SPACES_SECRET',
  'DO_SPACES_REGION',
  'DO_SPACES_BUCKET',
];

describe('BackupService S3 upload', () => {
  let tmpDir: string;
  let dbPath: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-svc-'));
    dbPath = path.join(tmpDir, 'source.db');
    await fs.writeFile(dbPath, 'SQLite format 3  (fake db contents)');
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    for (const k of [...SPACES_VARS, 'DATABASE_URL', 'BACKUP_DIR']) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    process.env.DATABASE_URL = `file:${dbPath}`;
    process.env.BACKUP_DIR = path.join(tmpDir, 'backups');
    sendMock.mockReset();
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('skips upload and reports which vars are missing when Spaces is not configured', async () => {
    // Only endpoint + bucket present; key + secret missing. No client injected.
    process.env.DO_SPACES_ENDPOINT = 'https://sfo3.digitaloceanspaces.com';
    process.env.DO_SPACES_BUCKET = 'test-bucket';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const svc = new BackupService({}, { s3Client: null });
    const result = await svc.createBackup();

    expect(result.s3).toBe(false);
    expect(result.s3Error).toMatch(/not configured/);
    expect(result.s3Error).toContain('DO_SPACES_KEY');
    expect(result.s3Error).toContain('DO_SPACES_SECRET');
    expect(sendMock).not.toHaveBeenCalled();
    // Startup warning is emitted so the misconfiguration is visible.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('DigitalOcean Spaces'));
    // The local backup still succeeds.
    expect(result.filename).toMatch(/^backup-.*\.db$/);
    warn.mockRestore();
  });

  it('uploads and reports s3:true with no error when fully configured', async () => {
    process.env.DO_SPACES_ENDPOINT = 'https://sfo3.digitaloceanspaces.com';
    process.env.DO_SPACES_KEY = 'AKIATEST';
    process.env.DO_SPACES_SECRET = 'secret-value';
    process.env.DO_SPACES_BUCKET = 'test-bucket';
    sendMock.mockResolvedValue({});

    const svc = new BackupService({}, { s3Client: fakeS3Client });
    const result = await svc.createBackup();

    expect(result.s3).toBe(true);
    expect(result.s3Error).toBeNull();
    expect(sendMock).toHaveBeenCalledTimes(1);
    // The PutObjectCommand carries the prefixed key for this backup.
    const cmd = sendMock.mock.calls[0][0];
    expect(cmd.input.Bucket).toBe('test-bucket');
    expect(cmd.input.Key).toContain(result.filename);
  });

  it('reports s3:false with the upload error when a configured upload fails', async () => {
    process.env.DO_SPACES_ENDPOINT = 'https://sfo3.digitaloceanspaces.com';
    process.env.DO_SPACES_KEY = 'AKIATEST';
    process.env.DO_SPACES_SECRET = 'secret-value';
    process.env.DO_SPACES_BUCKET = 'test-bucket';
    sendMock.mockRejectedValue(new Error('AccessDenied'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const svc = new BackupService({}, { s3Client: fakeS3Client });
    const result = await svc.createBackup();

    expect(result.s3).toBe(false);
    expect(result.s3Error).toMatch(/upload failed/);
    expect(result.s3Error).toContain('AccessDenied');
    err.mockRestore();
  });
});
