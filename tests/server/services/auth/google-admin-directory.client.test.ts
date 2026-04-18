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
 *
 * The real Admin SDK endpoint is NOT exercised in CI (requires live credentials).
 * Integration coverage for the real API path is deferred to T005.
 */

import { describe, it, expect } from 'vitest';
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
