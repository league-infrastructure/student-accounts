/**
 * Unit tests for google-admin-directory.client.ts (T004).
 *
 * Covers:
 *  - StaffOULookupError: name, code, email, cause properties.
 *  - FakeAdminDirectoryClient: returns the configured OU path.
 *  - FakeAdminDirectoryClient: propagates a configured StaffOULookupError.
 *  - GoogleAdminDirectoryClient: throws StaffOULookupError (MISSING_CREDENTIALS)
 *    when serviceAccountJson is empty.
 *  - GoogleAdminDirectoryClient: throws StaffOULookupError (MISSING_CREDENTIALS)
 *    when delegatedUser is empty.
 *  - GoogleAdminDirectoryClient: throws StaffOULookupError (MALFORMED_CREDENTIALS)
 *    when serviceAccountJson is not valid JSON.
 *  - GoogleAdminDirectoryClient (file path): happy path — reads credentials from file.
 *  - GoogleAdminDirectoryClient (file path): MALFORMED_CREDENTIALS when file missing.
 *  - GoogleAdminDirectoryClient (file path): MALFORMED_CREDENTIALS when file not valid JSON.
 *  - GoogleAdminDirectoryClient (file path): file wins when both file and inline JSON are set.
 *  - GoogleAdminDirectoryClient.resolveServiceAccountFilePath: bare filename resolves under config/files/.
 *  - GoogleAdminDirectoryClient.resolveServiceAccountFilePath: path with slashes used as-is.
 *
 * The real Admin SDK endpoint is NOT exercised in CI (requires live credentials).
 * Integration coverage for the real API path is deferred to T005.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  StaffOULookupError,
  FakeAdminDirectoryClient,
  GoogleAdminDirectoryClient,
} from '../../../../server/src/services/auth/google-admin-directory.client.js';

// ---------------------------------------------------------------------------
// StaffOULookupError
// ---------------------------------------------------------------------------

describe('StaffOULookupError', () => {
  it('sets name to StaffOULookupError', () => {
    const err = new StaffOULookupError('test message', 'TEST_CODE');
    expect(err.name).toBe('StaffOULookupError');
  });

  it('sets message, code, and email', () => {
    const err = new StaffOULookupError('lookup failed', 'API_ERROR', 'alice@jointheleague.org');
    expect(err.message).toBe('lookup failed');
    expect(err.code).toBe('API_ERROR');
    expect(err.email).toBe('alice@jointheleague.org');
  });

  it('is an instanceof Error', () => {
    const err = new StaffOULookupError('oops', 'SOME_CODE');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(StaffOULookupError);
  });

  it('stores the cause when provided', () => {
    const cause = new Error('network failure');
    const err = new StaffOULookupError('outer', 'API_ERROR', 'bob@jointheleague.org', cause);
    expect(err.cause).toBe(cause);
  });

  it('does not set email when omitted', () => {
    const err = new StaffOULookupError('no email', 'MISSING_CREDENTIALS');
    expect(err.email).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// FakeAdminDirectoryClient
// ---------------------------------------------------------------------------

describe('FakeAdminDirectoryClient — returns configured OU path', () => {
  it('returns the OU path string passed to the constructor', async () => {
    const fake = new FakeAdminDirectoryClient('/League Staff');
    const result = await fake.getUserOU('alice@jointheleague.org');
    expect(result).toBe('/League Staff');
  });

  it('ignores the email argument and always returns the configured path', async () => {
    const fake = new FakeAdminDirectoryClient('/Students');
    const resultA = await fake.getUserOU('a@jointheleague.org');
    const resultB = await fake.getUserOU('b@jointheleague.org');
    expect(resultA).toBe('/Students');
    expect(resultB).toBe('/Students');
  });

  it('can be configured with a deeply nested OU path', async () => {
    const fake = new FakeAdminDirectoryClient('/League Staff/Operations');
    const result = await fake.getUserOU('ops@jointheleague.org');
    expect(result).toBe('/League Staff/Operations');
  });
});

describe('FakeAdminDirectoryClient — configured to throw', () => {
  it('throws the StaffOULookupError passed to the constructor', async () => {
    const error = new StaffOULookupError(
      'credentials missing',
      'MISSING_CREDENTIALS',
      'alice@jointheleague.org',
    );
    const fake = new FakeAdminDirectoryClient(error);

    await expect(fake.getUserOU('alice@jointheleague.org')).rejects.toThrow(StaffOULookupError);
  });

  it('propagates the exact error instance, preserving code and email', async () => {
    const error = new StaffOULookupError('api error', 'API_ERROR', 'bob@jointheleague.org');
    const fake = new FakeAdminDirectoryClient(error);

    let caught: unknown;
    try {
      await fake.getUserOU('bob@jointheleague.org');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBe(error);
    expect((caught as StaffOULookupError).code).toBe('API_ERROR');
    expect((caught as StaffOULookupError).email).toBe('bob@jointheleague.org');
  });
});

// ---------------------------------------------------------------------------
// GoogleAdminDirectoryClient — credential error paths (no network)
// ---------------------------------------------------------------------------

describe('GoogleAdminDirectoryClient — missing credentials (RD-001)', () => {
  it('throws StaffOULookupError with code MISSING_CREDENTIALS when serviceAccountJson is empty', async () => {
    const client = new GoogleAdminDirectoryClient('', 'admin@jointheleague.org');

    await expect(client.getUserOU('alice@jointheleague.org')).rejects.toMatchObject({
      name: 'StaffOULookupError',
      code: 'MISSING_CREDENTIALS',
      email: 'alice@jointheleague.org',
    });
  });

  it('throws StaffOULookupError with code MISSING_CREDENTIALS when delegatedUser is empty', async () => {
    const client = new GoogleAdminDirectoryClient('{"type":"service_account"}', '');

    await expect(client.getUserOU('alice@jointheleague.org')).rejects.toMatchObject({
      name: 'StaffOULookupError',
      code: 'MISSING_CREDENTIALS',
      email: 'alice@jointheleague.org',
    });
  });

  it('throws StaffOULookupError with code MISSING_CREDENTIALS when both are empty', async () => {
    const client = new GoogleAdminDirectoryClient('', '');

    await expect(client.getUserOU('test@jointheleague.org')).rejects.toMatchObject({
      name: 'StaffOULookupError',
      code: 'MISSING_CREDENTIALS',
    });
  });
});

describe('GoogleAdminDirectoryClient — malformed credentials', () => {
  it('throws StaffOULookupError with code MALFORMED_CREDENTIALS for invalid JSON', async () => {
    const client = new GoogleAdminDirectoryClient(
      'not-valid-json',
      'admin@jointheleague.org',
    );

    await expect(client.getUserOU('alice@jointheleague.org')).rejects.toMatchObject({
      name: 'StaffOULookupError',
      code: 'MALFORMED_CREDENTIALS',
      email: 'alice@jointheleague.org',
    });
  });

  it('includes the original parse error as cause', async () => {
    const client = new GoogleAdminDirectoryClient(
      '{broken json',
      'admin@jointheleague.org',
    );

    let caught: unknown;
    try {
      await client.getUserOU('alice@jointheleague.org');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(StaffOULookupError);
    expect((caught as StaffOULookupError).cause).toBeInstanceOf(SyntaxError);
  });
});

// ---------------------------------------------------------------------------
// GoogleAdminDirectoryClient — GOOGLE_SERVICE_ACCOUNT_JSON_FILE path
// ---------------------------------------------------------------------------

/**
 * Helper: write content to a temp file and return its path.
 * The caller is responsible for deleting the file after the test.
 */
function writeTempFile(content: string): string {
  const tmpPath = path.join(os.tmpdir(), `gad-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmpPath, content, 'utf-8');
  return tmpPath;
}

describe('GoogleAdminDirectoryClient — file path (GOOGLE_SERVICE_ACCOUNT_FILE)', () => {
  // Track temp files created so we can clean them up.
  const tempFiles: string[] = [];

  afterEach(() => {
    for (const f of tempFiles) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
    tempFiles.length = 0;
  });

  it('happy path: constructs JWT auth from a valid service account JSON file', async () => {
    // A minimal service account JSON that passes parsing and JWT construction.
    // Note: this does NOT make a real API call — the test only verifies the
    // credentials are loaded and the JWT client is built. The API call itself
    // would fail with an auth error (no real key), but that's beyond MISSING/
    // MALFORMED paths that this unit test covers.
    const serviceAccountJson = JSON.stringify({
      type: 'service_account',
      client_email: 'test@project.iam.gserviceaccount.com',
      private_key: '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n',
      project_id: 'test-project',
    });
    const tmpPath = writeTempFile(serviceAccountJson);
    tempFiles.push(tmpPath);

    const client = new GoogleAdminDirectoryClient(
      '', // inline JSON is empty
      'admin@jointheleague.org',
      tmpPath, // file path takes precedence
    );

    // getUserOU will fail at the API call stage (AUTH_INIT_FAILED or API_ERROR),
    // not at MISSING/MALFORMED credential loading — that's what we verify here.
    let caught: unknown;
    try {
      await client.getUserOU('alice@jointheleague.org');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(StaffOULookupError);
    // Should NOT be MISSING_CREDENTIALS or MALFORMED_CREDENTIALS —
    // credentials were loaded successfully from the file.
    expect((caught as StaffOULookupError).code).not.toBe('MISSING_CREDENTIALS');
    expect((caught as StaffOULookupError).code).not.toBe('MALFORMED_CREDENTIALS');
  });

  it('throws MALFORMED_CREDENTIALS when the file path does not exist', async () => {
    const nonExistentPath = path.join(os.tmpdir(), 'does-not-exist-abc123.json');

    const client = new GoogleAdminDirectoryClient(
      '',
      'admin@jointheleague.org',
      nonExistentPath,
    );

    await expect(client.getUserOU('alice@jointheleague.org')).rejects.toMatchObject({
      name: 'StaffOULookupError',
      code: 'MALFORMED_CREDENTIALS',
      email: 'alice@jointheleague.org',
    });
  });

  it('throws MALFORMED_CREDENTIALS when the file exists but contains invalid JSON', async () => {
    const tmpPath = writeTempFile('this is not json {{{');
    tempFiles.push(tmpPath);

    const client = new GoogleAdminDirectoryClient(
      '',
      'admin@jointheleague.org',
      tmpPath,
    );

    await expect(client.getUserOU('alice@jointheleague.org')).rejects.toMatchObject({
      name: 'StaffOULookupError',
      code: 'MALFORMED_CREDENTIALS',
      email: 'alice@jointheleague.org',
    });
  });

  it('includes the underlying read/parse error as cause when file is invalid JSON', async () => {
    const tmpPath = writeTempFile('{broken');
    tempFiles.push(tmpPath);

    const client = new GoogleAdminDirectoryClient(
      '',
      'admin@jointheleague.org',
      tmpPath,
    );

    let caught: unknown;
    try {
      await client.getUserOU('alice@jointheleague.org');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(StaffOULookupError);
    expect((caught as StaffOULookupError).cause).toBeInstanceOf(SyntaxError);
  });

  it('file path wins (precedence) when both file path and inline JSON are set', async () => {
    // Both are set, but the file takes precedence.
    // The inline JSON is valid but the file does not exist → MALFORMED (file tried first).
    const nonExistentPath = path.join(os.tmpdir(), 'precedence-test-nonexistent.json');
    const validInlineJson = JSON.stringify({ type: 'service_account', client_email: 'x@x.iam.gserviceaccount.com', private_key: 'k' });

    const client = new GoogleAdminDirectoryClient(
      validInlineJson, // valid inline — would succeed loading
      'admin@jointheleague.org',
      nonExistentPath, // file takes precedence; this file does not exist → MALFORMED
    );

    await expect(client.getUserOU('alice@jointheleague.org')).rejects.toMatchObject({
      name: 'StaffOULookupError',
      code: 'MALFORMED_CREDENTIALS', // file was tried first and failed
    });
  });
});

// ---------------------------------------------------------------------------
// GoogleAdminDirectoryClient.resolveServiceAccountFilePath — path resolution
// ---------------------------------------------------------------------------

describe('GoogleAdminDirectoryClient.resolveServiceAccountFilePath', () => {
  it('resolves a bare filename against <cwd>/config/files/', () => {
    const result = GoogleAdminDirectoryClient.resolveServiceAccountFilePath(
      'gapps-integrations-fc9a96a0f34a.json',
    );
    expect(result).toBe(
      path.resolve(process.cwd(), 'config', 'files', 'gapps-integrations-fc9a96a0f34a.json'),
    );
  });

  it('uses an explicit relative path (with slashes) as-is via path.resolve', () => {
    const result = GoogleAdminDirectoryClient.resolveServiceAccountFilePath(
      './config/files/my-key.json',
    );
    expect(result).toBe(path.resolve(process.cwd(), './config/files/my-key.json'));
  });

  it('uses an absolute path unchanged', () => {
    const absPath = '/etc/secrets/google-sa.json';
    const result = GoogleAdminDirectoryClient.resolveServiceAccountFilePath(absPath);
    expect(result).toBe(absPath);
  });

  it('bare filename with no extension is still resolved under config/files/', () => {
    const result = GoogleAdminDirectoryClient.resolveServiceAccountFilePath('mykey');
    expect(result).toBe(path.resolve(process.cwd(), 'config', 'files', 'mykey'));
  });
});
