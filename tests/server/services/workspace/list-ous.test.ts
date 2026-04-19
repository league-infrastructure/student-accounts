/**
 * Unit tests for GoogleWorkspaceAdminClient.listOUs (Sprint 006 T005).
 *
 * Covers:
 *  - FakeGoogleWorkspaceAdminClient.listOUs returns seeded child OUs for a given
 *    parent path.
 *  - FakeGoogleWorkspaceAdminClient.listOUs returns empty array for a path with
 *    no seeded children.
 *  - FakeGoogleWorkspaceAdminClient.listOUs records the call in calls.listOUs.
 *  - FakeGoogleWorkspaceAdminClient.listOUs respects a configure() override.
 *  - FakeGoogleWorkspaceAdminClient.listOUs throws when configureError() is set.
 *  - FakeGoogleWorkspaceAdminClient.reset() clears seeded OUs.
 *  - GoogleWorkspaceAdminClientImpl.listOUs does NOT throw WorkspaceWriteDisabledError
 *    when the write-enable flag is absent (read-only path).
 *
 * The real Admin SDK is NOT exercised — real client tests verify only that the
 * write-enable flag is not checked.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  FakeGoogleWorkspaceAdminClient,
} from '../../helpers/fake-google-workspace-admin.client.js';
import {
  GoogleWorkspaceAdminClientImpl,
  WorkspaceApiError,
  WorkspaceWriteDisabledError,
  type WorkspaceOU,
} from '../../../../server/src/services/google-workspace/google-workspace-admin.client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PARENT_PATH = '/Students';

const CHILD_OUS: WorkspaceOU[] = [
  { orgUnitPath: '/Students/Spring2025', name: 'Spring2025' },
  { orgUnitPath: '/Students/Fall2025',   name: 'Fall2025' },
];

/** Minimal fake service account JSON (passes credential loading). */
const FAKE_SA_JSON = JSON.stringify({
  type: 'service_account',
  client_email: 'test-sa@project.iam.gserviceaccount.com',
  private_key: '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n',
  project_id: 'test-project',
});

const DELEGATED_USER = 'admin@jointheleague.org';

function makeRealClient(): GoogleWorkspaceAdminClientImpl {
  return new GoogleWorkspaceAdminClientImpl(FAKE_SA_JSON, DELEGATED_USER);
}

// ---------------------------------------------------------------------------
// FakeGoogleWorkspaceAdminClient — listOUs
// ---------------------------------------------------------------------------

describe('FakeGoogleWorkspaceAdminClient.listOUs — seeded data', () => {
  let fake: FakeGoogleWorkspaceAdminClient;

  beforeEach(() => {
    fake = new FakeGoogleWorkspaceAdminClient();
    fake.seedOUs(PARENT_PATH, CHILD_OUS);
  });

  it('returns child OUs seeded for the given parent path', async () => {
    const result = await fake.listOUs(PARENT_PATH);
    expect(result).toHaveLength(2);
    expect(result[0].orgUnitPath).toBe('/Students/Spring2025');
    expect(result[0].name).toBe('Spring2025');
    expect(result[1].orgUnitPath).toBe('/Students/Fall2025');
    expect(result[1].name).toBe('Fall2025');
  });

  it('returns empty array for a parent path with no seeded children', async () => {
    const result = await fake.listOUs('/SomeOtherPath');
    expect(result).toEqual([]);
  });

  it('records the call in calls.listOUs', async () => {
    await fake.listOUs(PARENT_PATH);
    expect(fake.calls.listOUs).toHaveLength(1);
    expect(fake.calls.listOUs[0]).toBe(PARENT_PATH);
  });

  it('records multiple calls', async () => {
    await fake.listOUs(PARENT_PATH);
    await fake.listOUs('/SomeOtherPath');
    expect(fake.calls.listOUs).toHaveLength(2);
    expect(fake.calls.listOUs[1]).toBe('/SomeOtherPath');
  });
});

// ---------------------------------------------------------------------------
// FakeGoogleWorkspaceAdminClient — configure() override
// ---------------------------------------------------------------------------

describe('FakeGoogleWorkspaceAdminClient.listOUs — configure() override', () => {
  let fake: FakeGoogleWorkspaceAdminClient;

  beforeEach(() => {
    fake = new FakeGoogleWorkspaceAdminClient();
    // Seed some data that should be ignored when an override is set
    fake.seedOUs(PARENT_PATH, CHILD_OUS);
  });

  it('returns the configured override instead of seeded data', async () => {
    const override: WorkspaceOU[] = [
      { orgUnitPath: '/Students/CustomCohort', name: 'CustomCohort' },
    ];
    fake.configure('listOUs', override);

    const result = await fake.listOUs(PARENT_PATH);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('CustomCohort');
  });

  it('returns the configured override for any parent path', async () => {
    const override: WorkspaceOU[] = [];
    fake.configure('listOUs', override);

    const result = await fake.listOUs('/AnyPath');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// FakeGoogleWorkspaceAdminClient — configureError()
// ---------------------------------------------------------------------------

describe('FakeGoogleWorkspaceAdminClient.listOUs — configureError()', () => {
  let fake: FakeGoogleWorkspaceAdminClient;

  beforeEach(() => {
    fake = new FakeGoogleWorkspaceAdminClient();
  });

  it('throws the configured error', async () => {
    const err = new WorkspaceApiError('orgunits.list failed', 'listOUs', 500);
    fake.configureError('listOUs', err);

    await expect(fake.listOUs(PARENT_PATH)).rejects.toThrow('orgunits.list failed');
  });

  it('still records the call before throwing', async () => {
    const err = new WorkspaceApiError('orgunits.list failed', 'listOUs', 500);
    fake.configureError('listOUs', err);

    try {
      await fake.listOUs(PARENT_PATH);
    } catch {
      // expected
    }

    expect(fake.calls.listOUs).toHaveLength(1);
    expect(fake.calls.listOUs[0]).toBe(PARENT_PATH);
  });
});

// ---------------------------------------------------------------------------
// FakeGoogleWorkspaceAdminClient — reset()
// ---------------------------------------------------------------------------

describe('FakeGoogleWorkspaceAdminClient.reset() — listOUs state', () => {
  let fake: FakeGoogleWorkspaceAdminClient;

  beforeEach(() => {
    fake = new FakeGoogleWorkspaceAdminClient();
  });

  it('clears seeded OUs after reset()', async () => {
    fake.seedOUs(PARENT_PATH, CHILD_OUS);
    fake.reset();

    const result = await fake.listOUs(PARENT_PATH);
    expect(result).toEqual([]);
  });

  it('clears recorded calls after reset()', async () => {
    await fake.listOUs(PARENT_PATH);
    fake.reset();

    expect(fake.calls.listOUs).toHaveLength(0);
  });

  it('clears configure() override after reset()', async () => {
    const override: WorkspaceOU[] = [{ orgUnitPath: '/Students/X', name: 'X' }];
    fake.configure('listOUs', override);
    fake.reset();

    // After reset, falls back to seeded data (empty since seed was also cleared)
    const result = await fake.listOUs(PARENT_PATH);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GoogleWorkspaceAdminClientImpl — listOUs is read-only (no write gate)
// ---------------------------------------------------------------------------

describe('GoogleWorkspaceAdminClientImpl.listOUs — read-only (no write gate)', () => {
  const savedFlag: { value: string | undefined } = { value: undefined };

  beforeEach(() => {
    savedFlag.value = process.env.GOOGLE_WORKSPACE_WRITE_ENABLED;
    // Explicitly disable write flag to confirm listOUs is unaffected
    delete process.env.GOOGLE_WORKSPACE_WRITE_ENABLED;
  });

  afterEach(() => {
    if (savedFlag.value === undefined) {
      delete process.env.GOOGLE_WORKSPACE_WRITE_ENABLED;
    } else {
      process.env.GOOGLE_WORKSPACE_WRITE_ENABLED = savedFlag.value;
    }
  });

  it('does NOT throw WorkspaceWriteDisabledError when write flag is absent', async () => {
    const client = makeRealClient();

    let caught: unknown;
    try {
      await client.listOUs(PARENT_PATH);
    } catch (err) {
      caught = err;
    }

    // Will fail at auth/SDK stage (no real credentials), but NOT WorkspaceWriteDisabledError
    expect(caught).toBeDefined();
    expect(caught).not.toBeInstanceOf(WorkspaceWriteDisabledError);
  });
});
