/**
 * Unit tests for write-enable flag and domain/OU guards in
 * GoogleWorkspaceAdminClientImpl (Sprint 004 T002).
 *
 * Covers:
 *  - WorkspaceWriteDisabledError: name and message.
 *  - WorkspaceDomainGuardError: name, message, and reason property.
 *  - Write gate: createUser throws WorkspaceWriteDisabledError when flag is absent.
 *  - Write gate: createUser throws WorkspaceWriteDisabledError when flag is "0".
 *  - Write gate: createOU throws WorkspaceWriteDisabledError when flag is absent.
 *  - Write gate: suspendUser throws WorkspaceWriteDisabledError when flag is absent.
 *  - Write gate: deleteUser throws WorkspaceWriteDisabledError when flag is absent.
 *  - Domain guard: createUser throws WorkspaceDomainGuardError for wrong email domain.
 *  - Domain guard: createUser throws WorkspaceDomainGuardError when OU is outside student root.
 *  - Happy path: createUser proceeds to SDK call with correct domain and OU (flag set).
 *  - Read-only: listUsersInOU does NOT require write-enable flag.
 *  - Read-only: getUserOU does NOT require write-enable flag.
 *
 * The real Admin SDK endpoint is NOT exercised — SDK calls are intercepted
 * before they reach the network (credentials fail fast at auth/API stage).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GoogleWorkspaceAdminClientImpl,
  WorkspaceWriteDisabledError,
  WorkspaceDomainGuardError,
  WorkspaceApiError,
  StaffOULookupError,
} from '../../../../server/src/services/google-workspace/google-workspace-admin.client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A minimal, parseable (but fake) service account JSON that passes credential
 * loading so the guard tests run before the SDK auth attempt.
 */
const FAKE_SA_JSON = JSON.stringify({
  type: 'service_account',
  client_email: 'test-sa@project.iam.gserviceaccount.com',
  private_key: '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n',
  project_id: 'test-project',
});

const DELEGATED_USER = 'admin@jointheleague.org';

/** Build a client instance with valid (fake) credentials. */
function makeClient(): GoogleWorkspaceAdminClientImpl {
  return new GoogleWorkspaceAdminClientImpl(FAKE_SA_JSON, DELEGATED_USER);
}

/** Valid params that pass both domain and OU guards (given matching env vars). */
const VALID_PARAMS = {
  primaryEmail: 'alice@students.jointheleague.org',
  orgUnitPath: '/Students/Spring2025',
  givenName: 'Alice',
  familyName: 'Smith',
  sendNotificationEmail: false,
};

// ---------------------------------------------------------------------------
// WorkspaceWriteDisabledError
// ---------------------------------------------------------------------------

describe('WorkspaceWriteDisabledError', () => {
  it('sets name to WorkspaceWriteDisabledError', () => {
    const err = new WorkspaceWriteDisabledError();
    expect(err.name).toBe('WorkspaceWriteDisabledError');
  });

  it('is an instanceof Error', () => {
    const err = new WorkspaceWriteDisabledError();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(WorkspaceWriteDisabledError);
  });

  it('includes GOOGLE_WORKSPACE_WRITE_ENABLED in the message', () => {
    const err = new WorkspaceWriteDisabledError();
    expect(err.message).toContain('GOOGLE_WORKSPACE_WRITE_ENABLED');
  });
});

// ---------------------------------------------------------------------------
// WorkspaceDomainGuardError
// ---------------------------------------------------------------------------

describe('WorkspaceDomainGuardError', () => {
  it('sets name to WorkspaceDomainGuardError', () => {
    const err = new WorkspaceDomainGuardError('bad domain');
    expect(err.name).toBe('WorkspaceDomainGuardError');
  });

  it('is an instanceof Error', () => {
    const err = new WorkspaceDomainGuardError('bad domain');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(WorkspaceDomainGuardError);
  });

  it('stores the reason property', () => {
    const err = new WorkspaceDomainGuardError('primaryEmail wrong domain');
    expect(err.reason).toBe('primaryEmail wrong domain');
  });

  it('includes the reason in the message', () => {
    const err = new WorkspaceDomainGuardError('my specific reason');
    expect(err.message).toContain('my specific reason');
  });
});

// ---------------------------------------------------------------------------
// Write-enable gate — createUser
// ---------------------------------------------------------------------------

describe('GoogleWorkspaceAdminClientImpl write gate — createUser', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.GOOGLE_WORKSPACE_WRITE_ENABLED = process.env.GOOGLE_WORKSPACE_WRITE_ENABLED;
    savedEnv.GOOGLE_STUDENT_DOMAIN = process.env.GOOGLE_STUDENT_DOMAIN;
    savedEnv.GOOGLE_STUDENT_OU_ROOT = process.env.GOOGLE_STUDENT_OU_ROOT;
  });

  afterEach(() => {
    if (savedEnv.GOOGLE_WORKSPACE_WRITE_ENABLED === undefined) {
      delete process.env.GOOGLE_WORKSPACE_WRITE_ENABLED;
    } else {
      process.env.GOOGLE_WORKSPACE_WRITE_ENABLED = savedEnv.GOOGLE_WORKSPACE_WRITE_ENABLED;
    }
    if (savedEnv.GOOGLE_STUDENT_DOMAIN === undefined) {
      delete process.env.GOOGLE_STUDENT_DOMAIN;
    } else {
      process.env.GOOGLE_STUDENT_DOMAIN = savedEnv.GOOGLE_STUDENT_DOMAIN;
    }
    if (savedEnv.GOOGLE_STUDENT_OU_ROOT === undefined) {
      delete process.env.GOOGLE_STUDENT_OU_ROOT;
    } else {
      process.env.GOOGLE_STUDENT_OU_ROOT = savedEnv.GOOGLE_STUDENT_OU_ROOT;
    }
  });

  it('throws WorkspaceWriteDisabledError when GOOGLE_WORKSPACE_WRITE_ENABLED is not set', async () => {
    delete process.env.GOOGLE_WORKSPACE_WRITE_ENABLED;
    const client = makeClient();

    await expect(client.createUser(VALID_PARAMS)).rejects.toBeInstanceOf(WorkspaceWriteDisabledError);
  });

  it('throws WorkspaceWriteDisabledError when GOOGLE_WORKSPACE_WRITE_ENABLED is "0"', async () => {
    process.env.GOOGLE_WORKSPACE_WRITE_ENABLED = '0';
    const client = makeClient();

    await expect(client.createUser(VALID_PARAMS)).rejects.toBeInstanceOf(WorkspaceWriteDisabledError);
  });

  it('throws WorkspaceWriteDisabledError when GOOGLE_WORKSPACE_WRITE_ENABLED is "true" (not exactly "1")', async () => {
    process.env.GOOGLE_WORKSPACE_WRITE_ENABLED = 'true';
    const client = makeClient();

    await expect(client.createUser(VALID_PARAMS)).rejects.toBeInstanceOf(WorkspaceWriteDisabledError);
  });

  it('does NOT throw WorkspaceWriteDisabledError when GOOGLE_WORKSPACE_WRITE_ENABLED is "1"', async () => {
    process.env.GOOGLE_WORKSPACE_WRITE_ENABLED = '1';
    process.env.GOOGLE_STUDENT_DOMAIN = 'students.jointheleague.org';
    process.env.GOOGLE_STUDENT_OU_ROOT = '/Students';
    const client = makeClient();

    // Will fail at auth/API stage (not at the guard) — error is NOT WorkspaceWriteDisabledError
    let caught: unknown;
    try {
      await client.createUser(VALID_PARAMS);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught).not.toBeInstanceOf(WorkspaceWriteDisabledError);
    expect(caught).not.toBeInstanceOf(WorkspaceDomainGuardError);
  });
});

// ---------------------------------------------------------------------------
// Write-enable gate — createOU
// ---------------------------------------------------------------------------

describe('GoogleWorkspaceAdminClientImpl write gate — createOU', () => {
  const savedFlag: { value: string | undefined } = { value: undefined };

  beforeEach(() => {
    savedFlag.value = process.env.GOOGLE_WORKSPACE_WRITE_ENABLED;
  });

  afterEach(() => {
    if (savedFlag.value === undefined) {
      delete process.env.GOOGLE_WORKSPACE_WRITE_ENABLED;
    } else {
      process.env.GOOGLE_WORKSPACE_WRITE_ENABLED = savedFlag.value;
    }
  });

  it('throws WorkspaceWriteDisabledError when flag is absent', async () => {
    delete process.env.GOOGLE_WORKSPACE_WRITE_ENABLED;
    const client = makeClient();

    await expect(client.createOU('Spring2025')).rejects.toBeInstanceOf(WorkspaceWriteDisabledError);
  });
});

// ---------------------------------------------------------------------------
// Write-enable gate — suspendUser
// ---------------------------------------------------------------------------

describe('GoogleWorkspaceAdminClientImpl write gate — suspendUser', () => {
  const savedFlag: { value: string | undefined } = { value: undefined };

  beforeEach(() => {
    savedFlag.value = process.env.GOOGLE_WORKSPACE_WRITE_ENABLED;
  });

  afterEach(() => {
    if (savedFlag.value === undefined) {
      delete process.env.GOOGLE_WORKSPACE_WRITE_ENABLED;
    } else {
      process.env.GOOGLE_WORKSPACE_WRITE_ENABLED = savedFlag.value;
    }
  });

  it('throws WorkspaceWriteDisabledError when flag is absent', async () => {
    delete process.env.GOOGLE_WORKSPACE_WRITE_ENABLED;
    const client = makeClient();

    await expect(client.suspendUser('alice@students.jointheleague.org')).rejects.toBeInstanceOf(
      WorkspaceWriteDisabledError,
    );
  });
});

// ---------------------------------------------------------------------------
// Write-enable gate — deleteUser
// ---------------------------------------------------------------------------

describe('GoogleWorkspaceAdminClientImpl write gate — deleteUser', () => {
  const savedFlag: { value: string | undefined } = { value: undefined };

  beforeEach(() => {
    savedFlag.value = process.env.GOOGLE_WORKSPACE_WRITE_ENABLED;
  });

  afterEach(() => {
    if (savedFlag.value === undefined) {
      delete process.env.GOOGLE_WORKSPACE_WRITE_ENABLED;
    } else {
      process.env.GOOGLE_WORKSPACE_WRITE_ENABLED = savedFlag.value;
    }
  });

  it('throws WorkspaceWriteDisabledError when flag is absent', async () => {
    delete process.env.GOOGLE_WORKSPACE_WRITE_ENABLED;
    const client = makeClient();

    await expect(client.deleteUser('alice@students.jointheleague.org')).rejects.toBeInstanceOf(
      WorkspaceWriteDisabledError,
    );
  });
});

// ---------------------------------------------------------------------------
// Domain/OU guard — createUser
// ---------------------------------------------------------------------------

describe('GoogleWorkspaceAdminClientImpl domain/OU guard — createUser', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.GOOGLE_WORKSPACE_WRITE_ENABLED = process.env.GOOGLE_WORKSPACE_WRITE_ENABLED;
    savedEnv.GOOGLE_STUDENT_DOMAIN = process.env.GOOGLE_STUDENT_DOMAIN;
    savedEnv.GOOGLE_STUDENT_OU_ROOT = process.env.GOOGLE_STUDENT_OU_ROOT;

    // Enable writes for all guard tests
    process.env.GOOGLE_WORKSPACE_WRITE_ENABLED = '1';
    process.env.GOOGLE_STUDENT_DOMAIN = 'students.jointheleague.org';
    process.env.GOOGLE_STUDENT_OU_ROOT = '/Students';
  });

  afterEach(() => {
    for (const key of ['GOOGLE_WORKSPACE_WRITE_ENABLED', 'GOOGLE_STUDENT_DOMAIN', 'GOOGLE_STUDENT_OU_ROOT']) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it('throws WorkspaceDomainGuardError when primaryEmail is on the wrong domain', async () => {
    const client = makeClient();

    await expect(
      client.createUser({
        ...VALID_PARAMS,
        primaryEmail: 'alice@jointheleague.org', // staff domain, not student domain
      }),
    ).rejects.toBeInstanceOf(WorkspaceDomainGuardError);
  });

  it('domain guard error includes a descriptive reason for wrong domain', async () => {
    const client = makeClient();

    let caught: unknown;
    try {
      await client.createUser({
        ...VALID_PARAMS,
        primaryEmail: 'alice@jointheleague.org',
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(WorkspaceDomainGuardError);
    expect((caught as WorkspaceDomainGuardError).reason).toContain('jointheleague.org');
  });

  it('throws WorkspaceDomainGuardError when orgUnitPath is outside student OU root', async () => {
    const client = makeClient();

    await expect(
      client.createUser({
        ...VALID_PARAMS,
        orgUnitPath: '/League Staff/Instructors', // not under /Students
      }),
    ).rejects.toBeInstanceOf(WorkspaceDomainGuardError);
  });

  it('OU guard error includes a descriptive reason for wrong OU', async () => {
    const client = makeClient();

    let caught: unknown;
    try {
      await client.createUser({
        ...VALID_PARAMS,
        orgUnitPath: '/League Staff/Instructors',
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(WorkspaceDomainGuardError);
    expect((caught as WorkspaceDomainGuardError).reason).toContain('/Students');
  });

  it('domain guard fires before OU guard (wrong domain + wrong OU → domain error)', async () => {
    const client = makeClient();

    let caught: unknown;
    try {
      await client.createUser({
        ...VALID_PARAMS,
        primaryEmail: 'alice@jointheleague.org',
        orgUnitPath: '/League Staff/Instructors',
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(WorkspaceDomainGuardError);
    expect((caught as WorkspaceDomainGuardError).reason).toContain('jointheleague.org');
  });

  it('does NOT throw WorkspaceDomainGuardError when domain and OU are valid', async () => {
    const client = makeClient();

    // Will fail at auth/API stage (not at the guard)
    let caught: unknown;
    try {
      await client.createUser(VALID_PARAMS);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught).not.toBeInstanceOf(WorkspaceDomainGuardError);
    expect(caught).not.toBeInstanceOf(WorkspaceWriteDisabledError);
  });
});

// ---------------------------------------------------------------------------
// Read-only methods: NOT gated by write-enable flag
// ---------------------------------------------------------------------------

describe('GoogleWorkspaceAdminClientImpl read-only methods bypass write gate', () => {
  const savedFlag: { value: string | undefined } = { value: undefined };

  beforeEach(() => {
    savedFlag.value = process.env.GOOGLE_WORKSPACE_WRITE_ENABLED;
    // Explicitly disable write flag to confirm read methods are unaffected
    delete process.env.GOOGLE_WORKSPACE_WRITE_ENABLED;
  });

  afterEach(() => {
    if (savedFlag.value === undefined) {
      delete process.env.GOOGLE_WORKSPACE_WRITE_ENABLED;
    } else {
      process.env.GOOGLE_WORKSPACE_WRITE_ENABLED = savedFlag.value;
    }
  });

  it('listUsersInOU does NOT throw WorkspaceWriteDisabledError when flag is absent', async () => {
    const client = makeClient();

    let caught: unknown;
    try {
      await client.listUsersInOU('/Students/Spring2025');
    } catch (err) {
      caught = err;
    }

    // Will fail due to auth/SDK error (no real credentials), but NOT WorkspaceWriteDisabledError
    expect(caught).not.toBeInstanceOf(WorkspaceWriteDisabledError);
  });

  it('getUserOU does NOT throw WorkspaceWriteDisabledError when flag is absent', async () => {
    const client = makeClient();

    let caught: unknown;
    try {
      await client.getUserOU('alice@jointheleague.org');
    } catch (err) {
      caught = err;
    }

    // Will fail at auth/SDK stage, but NOT WorkspaceWriteDisabledError
    expect(caught).not.toBeInstanceOf(WorkspaceWriteDisabledError);
  });
});
