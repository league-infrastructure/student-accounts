/**
 * Unit tests for google-workspace-admin.client.ts (Sprint 004 T001).
 *
 * Covers:
 *  - StaffOULookupError: name, code, email, cause properties.
 *  - FakeGoogleWorkspaceAdminClient: getUserOU returns the configured OU path.
 *  - FakeGoogleWorkspaceAdminClient: propagates a configured error.
 *  - FakeGoogleWorkspaceAdminClient: call recording for all methods.
 *  - FakeGoogleWorkspaceAdminClient: configurable return values per method.
 *  - FakeGoogleWorkspaceAdminClient: configurable thrown errors per method.
 *  - GoogleWorkspaceAdminClientImpl: throws StaffOULookupError (MISSING_CREDENTIALS)
 *    when serviceAccountJson is empty.
 *  - GoogleWorkspaceAdminClientImpl: throws StaffOULookupError (MISSING_CREDENTIALS)
 *    when delegatedUser is empty.
 *  - GoogleWorkspaceAdminClientImpl: throws StaffOULookupError (MALFORMED_CREDENTIALS)
 *    when serviceAccountJson is not valid JSON.
 *  - GoogleWorkspaceAdminClientImpl (file path): happy path — reads credentials from file.
 *  - GoogleWorkspaceAdminClientImpl (file path): MALFORMED_CREDENTIALS when file missing.
 *  - GoogleWorkspaceAdminClientImpl (file path): MALFORMED_CREDENTIALS when file not valid JSON.
 *  - GoogleWorkspaceAdminClientImpl (file path): file wins when both file and inline JSON are set.
 *  - GoogleWorkspaceAdminClientImpl.resolveServiceAccountFilePath: bare filename resolves under config/files/.
 *  - GoogleWorkspaceAdminClientImpl.resolveServiceAccountFilePath: path with slashes used as-is.
 *
 * The real Admin SDK endpoint is NOT exercised in CI (requires live credentials).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  StaffOULookupError,
  WorkspaceApiError,
  GoogleWorkspaceAdminClientImpl,
} from '../../../../server/src/services/google-workspace/google-workspace-admin.client.js';
import {
  FakeGoogleWorkspaceAdminClient,
} from '../../helpers/fake-google-workspace-admin.client.js';

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
// FakeGoogleWorkspaceAdminClient
// ---------------------------------------------------------------------------

describe('FakeGoogleWorkspaceAdminClient — getUserOU default behavior', () => {
  it('returns the default OU path when no override is configured', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    const result = await fake.getUserOU('alice@jointheleague.org');
    expect(result).toBe('/League Staff');
  });

  it('returns a configured OU path when configure() is called', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    fake.configure('getUserOU', '/Students/Spring2025');
    const result = await fake.getUserOU('alice@jointheleague.org');
    expect(result).toBe('/Students/Spring2025');
  });

  it('records the email argument in calls.getUserOU', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    await fake.getUserOU('alice@jointheleague.org');
    await fake.getUserOU('bob@jointheleague.org');
    expect(fake.calls.getUserOU).toEqual([
      'alice@jointheleague.org',
      'bob@jointheleague.org',
    ]);
  });
});

describe('FakeGoogleWorkspaceAdminClient — configureError for getUserOU', () => {
  it('throws the configured error when configureError is called', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    const error = new StaffOULookupError(
      'credentials missing',
      'MISSING_CREDENTIALS',
      'alice@jointheleague.org',
    );
    fake.configureError('getUserOU', error);

    await expect(fake.getUserOU('alice@jointheleague.org')).rejects.toThrow(StaffOULookupError);
  });

  it('propagates the exact error instance, preserving code and email', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    const error = new StaffOULookupError('api error', 'API_ERROR', 'bob@jointheleague.org');
    fake.configureError('getUserOU', error);

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

describe('FakeGoogleWorkspaceAdminClient — createUser', () => {
  it('returns default { id, primaryEmail } from params', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    const result = await fake.createUser({
      primaryEmail: 'alice@students.example.com',
      orgUnitPath: '/Students/Spring2025',
      givenName: 'Alice',
      familyName: 'Example',
      sendNotificationEmail: false,
    });
    expect(result).toEqual({ id: 'fake-gws-user-id', primaryEmail: 'alice@students.example.com' });
  });

  it('records the CreateUserParams in calls.createUser', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    const params = {
      primaryEmail: 'alice@students.example.com',
      orgUnitPath: '/Students/Spring2025',
      givenName: 'Alice',
      familyName: 'Example',
      sendNotificationEmail: true,
    };
    await fake.createUser(params);
    expect(fake.calls.createUser).toHaveLength(1);
    expect(fake.calls.createUser[0]).toEqual(params);
  });

  it('returns a configured value when configure() is called', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    fake.configure('createUser', { id: 'custom-id', primaryEmail: 'custom@students.example.com' });
    const result = await fake.createUser({
      primaryEmail: 'x@students.example.com',
      orgUnitPath: '/Students',
      givenName: 'X',
      familyName: 'Y',
      sendNotificationEmail: false,
    });
    expect(result).toEqual({ id: 'custom-id', primaryEmail: 'custom@students.example.com' });
  });

  it('throws a configured error when configureError() is called', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    const err = new WorkspaceApiError('conflict', 'createUser', 409);
    fake.configureError('createUser', err);

    await expect(
      fake.createUser({
        primaryEmail: 'x@students.example.com',
        orgUnitPath: '/Students',
        givenName: 'X',
        familyName: 'Y',
        sendNotificationEmail: false,
      }),
    ).rejects.toThrow(WorkspaceApiError);
  });
});

describe('FakeGoogleWorkspaceAdminClient — createOU', () => {
  it('returns default { ouPath } using /Students/ + name', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    const result = await fake.createOU('Spring2025');
    expect(result).toEqual({ ouPath: '/Students/Spring2025' });
  });

  it('records the OU name in calls.createOU', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    await fake.createOU('Cohort-A');
    await fake.createOU('Cohort-B');
    expect(fake.calls.createOU).toEqual(['Cohort-A', 'Cohort-B']);
  });

  it('throws a configured error when configureError() is called', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    fake.configureError('createOU', new WorkspaceApiError('OU already exists', 'createOU', 409));
    await expect(fake.createOU('Spring2025')).rejects.toThrow(WorkspaceApiError);
  });
});

describe('FakeGoogleWorkspaceAdminClient — suspendUser', () => {
  it('resolves void by default', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    await expect(fake.suspendUser('alice@students.example.com')).resolves.toBeUndefined();
  });

  it('records the email in calls.suspendUser', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    await fake.suspendUser('alice@students.example.com');
    expect(fake.calls.suspendUser).toEqual(['alice@students.example.com']);
  });

  it('throws a configured error when configureError() is called', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    fake.configureError('suspendUser', new WorkspaceApiError('not found', 'suspendUser', 404));
    await expect(fake.suspendUser('alice@students.example.com')).rejects.toThrow(WorkspaceApiError);
  });
});

describe('FakeGoogleWorkspaceAdminClient — deleteUser', () => {
  it('resolves void by default', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    await expect(fake.deleteUser('alice@students.example.com')).resolves.toBeUndefined();
  });

  it('records the email in calls.deleteUser', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    await fake.deleteUser('alice@students.example.com');
    expect(fake.calls.deleteUser).toEqual(['alice@students.example.com']);
  });

  it('throws a configured error when configureError() is called', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    fake.configureError('deleteUser', new WorkspaceApiError('not found', 'deleteUser', 404));
    await expect(fake.deleteUser('alice@students.example.com')).rejects.toThrow(WorkspaceApiError);
  });
});

describe('FakeGoogleWorkspaceAdminClient — listUsersInOU', () => {
  it('returns an empty array by default', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    const result = await fake.listUsersInOU('/Students/Spring2025');
    expect(result).toEqual([]);
  });

  it('records the ouPath in calls.listUsersInOU', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    await fake.listUsersInOU('/Students/Spring2025');
    expect(fake.calls.listUsersInOU).toEqual(['/Students/Spring2025']);
  });

  it('returns a configured list when configure() is called', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    const users = [
      { id: 'uid-1', primaryEmail: 'alice@s.example.com', orgUnitPath: '/Students/Spring2025' },
    ];
    fake.configure('listUsersInOU', users);
    const result = await fake.listUsersInOU('/Students/Spring2025');
    expect(result).toEqual(users);
  });

  it('throws a configured error when configureError() is called', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    fake.configureError('listUsersInOU', new WorkspaceApiError('forbidden', 'listUsersInOU', 403));
    await expect(fake.listUsersInOU('/Students')).rejects.toThrow(WorkspaceApiError);
  });
});

describe('FakeGoogleWorkspaceAdminClient — reset()', () => {
  it('clears call records and configured overrides', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    fake.configure('getUserOU', '/Custom/OU');
    await fake.getUserOU('alice@jointheleague.org');
    expect(fake.calls.getUserOU).toHaveLength(1);

    fake.reset();

    expect(fake.calls.getUserOU).toHaveLength(0);
    // After reset, default behavior is restored
    const result = await fake.getUserOU('alice@jointheleague.org');
    expect(result).toBe('/League Staff');
  });
});

// ---------------------------------------------------------------------------
// GoogleWorkspaceAdminClientImpl — credential error paths (no network)
// ---------------------------------------------------------------------------

describe('GoogleWorkspaceAdminClientImpl — missing credentials (RD-001)', () => {
  it('throws StaffOULookupError with code MISSING_CREDENTIALS when serviceAccountJson is empty', async () => {
    const client = new GoogleWorkspaceAdminClientImpl('', 'admin@jointheleague.org');

    await expect(client.getUserOU('alice@jointheleague.org')).rejects.toMatchObject({
      name: 'StaffOULookupError',
      code: 'MISSING_CREDENTIALS',
      email: 'alice@jointheleague.org',
    });
  });

  it('throws StaffOULookupError with code MISSING_CREDENTIALS when delegatedUser is empty', async () => {
    const client = new GoogleWorkspaceAdminClientImpl('{"type":"service_account"}', '');

    await expect(client.getUserOU('alice@jointheleague.org')).rejects.toMatchObject({
      name: 'StaffOULookupError',
      code: 'MISSING_CREDENTIALS',
      email: 'alice@jointheleague.org',
    });
  });

  it('throws StaffOULookupError with code MISSING_CREDENTIALS when both are empty', async () => {
    const client = new GoogleWorkspaceAdminClientImpl('', '');

    await expect(client.getUserOU('test@jointheleague.org')).rejects.toMatchObject({
      name: 'StaffOULookupError',
      code: 'MISSING_CREDENTIALS',
    });
  });
});

describe('GoogleWorkspaceAdminClientImpl — malformed credentials', () => {
  it('throws StaffOULookupError with code MALFORMED_CREDENTIALS for invalid JSON', async () => {
    const client = new GoogleWorkspaceAdminClientImpl(
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
    const client = new GoogleWorkspaceAdminClientImpl(
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
// GoogleWorkspaceAdminClientImpl — GOOGLE_SERVICE_ACCOUNT_JSON_FILE path
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

describe('GoogleWorkspaceAdminClientImpl — file path (GOOGLE_SERVICE_ACCOUNT_FILE)', () => {
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

    const client = new GoogleWorkspaceAdminClientImpl(
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

    const client = new GoogleWorkspaceAdminClientImpl(
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

    const client = new GoogleWorkspaceAdminClientImpl(
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

    const client = new GoogleWorkspaceAdminClientImpl(
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

    const client = new GoogleWorkspaceAdminClientImpl(
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
// GoogleWorkspaceAdminClientImpl.resolveServiceAccountFilePath — path resolution
// ---------------------------------------------------------------------------

describe('GoogleWorkspaceAdminClientImpl.resolveServiceAccountFilePath', () => {
  it('falls back to <cwd>/config/files/ for a bare filename that does not exist', () => {
    const result = GoogleWorkspaceAdminClientImpl.resolveServiceAccountFilePath(
      'does-not-exist-test-fixture.json',
    );
    expect(result).toBe(
      path.resolve(process.cwd(), 'config', 'files', 'does-not-exist-test-fixture.json'),
    );
  });

  it('probes <parent>/config/files/ for a bare filename that exists there', () => {
    // The real credentials fixture lives at repo-root/config/files/ but
    // the server cwd is server/ — the resolver probes both.
    const result = GoogleWorkspaceAdminClientImpl.resolveServiceAccountFilePath(
      'gapps-integrations-fc9a96a0f34a.json',
    );
    expect(result).toBe(
      path.resolve(process.cwd(), '..', 'config', 'files', 'gapps-integrations-fc9a96a0f34a.json'),
    );
  });

  it('uses an explicit relative path (with slashes) as-is via path.resolve (cwd anchor)', () => {
    const result = GoogleWorkspaceAdminClientImpl.resolveServiceAccountFilePath(
      './config/files/does-not-exist.json',
    );
    expect(result).toBe(path.resolve(process.cwd(), './config/files/does-not-exist.json'));
  });

  it('uses an absolute path unchanged', () => {
    const absPath = '/etc/secrets/google-sa.json';
    const result = GoogleWorkspaceAdminClientImpl.resolveServiceAccountFilePath(absPath);
    expect(result).toBe(absPath);
  });

  it('bare filename with no extension is still resolved under config/files/', () => {
    const result = GoogleWorkspaceAdminClientImpl.resolveServiceAccountFilePath('mykey');
    expect(result).toBe(path.resolve(process.cwd(), 'config', 'files', 'mykey'));
  });
});
