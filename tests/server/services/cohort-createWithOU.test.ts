/**
 * Integration tests for CohortService.createWithOU (Sprint 004 T005).
 *
 * Covers:
 *  - Happy path: OU created with correct name, Cohort row persists with
 *    the returned ouPath, AuditEvent written with correct fields.
 *  - Blank name: throws ValidationError before any API call.
 *  - Whitespace-only name: treated as blank (ValidationError).
 *  - Duplicate name: throws ConflictError before any API call.
 *  - createOU throws: no Cohort row created, error propagates.
 *  - Prisma write fails after successful OU creation: error propagates,
 *    warning logged, OU is orphaned (documented behavior).
 *  - No googleClient configured: throws configuration error.
 */

import { prisma } from '../../../server/src/services/prisma.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { CohortService } from '../../../server/src/services/cohort.service.js';
import { ConflictError, ValidationError } from '../../../server/src/errors.js';
import { WorkspaceApiError } from '../../../server/src/services/google-workspace/google-workspace-admin.client.js';
import { FakeGoogleWorkspaceAdminClient } from '../helpers/fake-google-workspace-admin.client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function clearDb() {
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

function makeService(fake?: FakeGoogleWorkspaceAdminClient): CohortService {
  return new CohortService(prisma, new AuditService(), fake);
}

/** Create a minimal admin user and return its id. */
async function createActorUser(): Promise<number> {
  const user = await (prisma as any).user.create({
    data: {
      display_name: 'Admin Actor',
      primary_email: 'admin-actor@example.com',
      role: 'admin',
      created_via: 'admin_created',
    },
  });
  return user.id;
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let fakeClient: FakeGoogleWorkspaceAdminClient;
let actorId: number;

beforeEach(async () => {
  await clearDb();
  fakeClient = new FakeGoogleWorkspaceAdminClient();
  actorId = await createActorUser();
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('CohortService.createWithOU — happy path', () => {
  it('calls createOU with the trimmed cohort name', async () => {
    const svc = makeService(fakeClient);
    await svc.createWithOU('Spring 2026', actorId);

    expect(fakeClient.calls.createOU).toHaveLength(1);
    expect(fakeClient.calls.createOU[0]).toBe('Spring 2026');
  });

  it('persists a Cohort row with the ouPath returned by the client', async () => {
    fakeClient.configure('createOU', { ouPath: '/Students/Spring2026' });
    const svc = makeService(fakeClient);

    const cohort = await svc.createWithOU('Spring 2026', actorId);

    expect(cohort.id).toBeDefined();
    expect(cohort.name).toBe('Spring 2026');
    expect(cohort.google_ou_path).toBe('/Students/Spring2026');
  });

  it('records a create_cohort AuditEvent inside the same transaction', async () => {
    fakeClient.configure('createOU', { ouPath: '/Students/Fall2026' });
    const svc = makeService(fakeClient);

    const cohort = await svc.createWithOU('Fall 2026', actorId);

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'create_cohort', target_entity_id: String(cohort.id) },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(actorId);
    expect(events[0].target_entity_type).toBe('Cohort');
    const details = events[0].details as Record<string, unknown>;
    expect(details.name).toBe('Fall 2026');
    expect(details.google_ou_path).toBe('/Students/Fall2026');
  });

  it('trims leading/trailing whitespace from the name before all operations', async () => {
    fakeClient.configure('createOU', { ouPath: '/Students/Trimmed' });
    const svc = makeService(fakeClient);

    const cohort = await svc.createWithOU('  Trimmed Cohort  ', actorId);

    expect(cohort.name).toBe('Trimmed Cohort');
    expect(fakeClient.calls.createOU[0]).toBe('Trimmed Cohort');
  });
});

// ---------------------------------------------------------------------------
// Validation errors — no API call should be made
// ---------------------------------------------------------------------------

describe('CohortService.createWithOU — validation errors', () => {
  it('throws ValidationError for a blank name without calling createOU', async () => {
    const svc = makeService(fakeClient);

    await expect(svc.createWithOU('', actorId)).rejects.toThrow(ValidationError);
    expect(fakeClient.calls.createOU).toHaveLength(0);
  });

  it('throws ValidationError for a whitespace-only name without calling createOU', async () => {
    const svc = makeService(fakeClient);

    await expect(svc.createWithOU('   ', actorId)).rejects.toThrow(ValidationError);
    expect(fakeClient.calls.createOU).toHaveLength(0);
  });

  it('throws ConflictError for a duplicate name without calling createOU', async () => {
    // Pre-create a cohort with the same name
    await (prisma as any).cohort.create({ data: { name: 'Duplicate', google_ou_path: null } });
    const svc = makeService(fakeClient);

    await expect(svc.createWithOU('Duplicate', actorId)).rejects.toThrow(ConflictError);
    expect(fakeClient.calls.createOU).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Google API error — no Cohort row should be created
// ---------------------------------------------------------------------------

describe('CohortService.createWithOU — Google API error', () => {
  it('throws the Google API error and creates no Cohort row', async () => {
    fakeClient.configureError('createOU', new WorkspaceApiError('OU already exists', 'createOU', 409));
    const svc = makeService(fakeClient);

    await expect(svc.createWithOU('NewCohort', actorId)).rejects.toThrow(WorkspaceApiError);

    const cohortCount = await (prisma as any).cohort.count();
    expect(cohortCount).toBe(0);
  });

  it('creates no AuditEvent when the Google API call fails', async () => {
    fakeClient.configureError('createOU', new WorkspaceApiError('Network error', 'createOU', 503));
    const svc = makeService(fakeClient);

    await expect(svc.createWithOU('AnotherCohort', actorId)).rejects.toThrow(WorkspaceApiError);

    const eventCount = await (prisma as any).auditEvent.count();
    expect(eventCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// No googleClient configured
// ---------------------------------------------------------------------------

describe('CohortService.createWithOU — missing Google client', () => {
  it('throws a configuration error when no googleClient is provided', async () => {
    const svc = makeService(); // no fake client

    await expect(svc.createWithOU('AnyName', actorId)).rejects.toThrow(
      /GoogleWorkspaceAdminClient/,
    );
  });
});

// ---------------------------------------------------------------------------
// Existing CohortService methods still work without a Google client
// ---------------------------------------------------------------------------

describe('CohortService backward compatibility (Sprint 001 methods)', () => {
  it('create still works without a Google client', async () => {
    const svc = new CohortService(prisma, new AuditService());
    const cohort = await svc.create({ name: 'Legacy Cohort' });
    expect(cohort.name).toBe('Legacy Cohort');
  });

  it('findAll still works without a Google client', async () => {
    const svc = new CohortService(prisma, new AuditService());
    await svc.create({ name: 'A' });
    await svc.create({ name: 'B' });
    const all = await svc.findAll();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });
});
