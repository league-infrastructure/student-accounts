/**
 * Integration tests for WorkspaceProvisioningService (Sprint 004, T004).
 *
 * Covers:
 *  - Happy path: ExternalAccount created, audit event recorded, Google client
 *    called with correct arguments, Pike13 stub invoked.
 *  - Non-student role → UnprocessableError, no API call.
 *  - No cohort assigned → UnprocessableError, no API call.
 *  - Cohort without google_ou_path → UnprocessableError, no API call.
 *  - Existing active workspace ExternalAccount → ConflictError.
 *  - Existing pending workspace ExternalAccount → ConflictError.
 *  - Workspace client throws WorkspaceApiError → propagates, no ExternalAccount.
 *  - Workspace client throws WorkspaceDomainGuardError → propagates.
 *  - Workspace client throws WorkspaceWriteDisabledError → propagates.
 *  - Missing GOOGLE_STUDENT_DOMAIN env var → UnprocessableError.
 */

import { prisma } from '../../../server/src/services/prisma.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { WorkspaceProvisioningService } from '../../../server/src/services/workspace-provisioning.service.js';
import { ExternalAccountRepository } from '../../../server/src/services/repositories/external-account.repository.js';
import { UserRepository } from '../../../server/src/services/repositories/user.repository.js';
import { CohortRepository } from '../../../server/src/services/repositories/cohort.repository.js';
import {
  WorkspaceApiError,
  WorkspaceDomainGuardError,
  WorkspaceWriteDisabledError,
} from '../../../server/src/services/google-workspace/google-workspace-admin.client.js';
import { ConflictError, UnprocessableError } from '../../../server/src/errors.js';
import { FakeGoogleWorkspaceAdminClient } from '../helpers/fake-google-workspace-admin.client.js';
import { makeCohort, makeUser, makeExternalAccount } from '../helpers/factories.js';
import * as pike13WritebackStub from '../../../server/src/services/pike13/pike13-writeback.service.js';
import { vi } from 'vitest';
import type { Prisma } from '../../../server/src/generated/prisma/client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function clearDb() {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

const STUDENT_DOMAIN = 'students.jointheleague.org';

function makeService(fake: FakeGoogleWorkspaceAdminClient): WorkspaceProvisioningService {
  return new WorkspaceProvisioningService(
    fake,
    ExternalAccountRepository,
    new AuditService(),
    UserRepository,
    CohortRepository,
  );
}

/**
 * Run the service inside a real prisma.$transaction so the tx parameter
 * is a genuine TransactionClient. This mirrors how ProvisioningRequestService
 * will call it in T007.
 */
async function runInTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return (prisma as any).$transaction(fn);
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let fakeClient: FakeGoogleWorkspaceAdminClient;
let originalDomain: string | undefined;

beforeEach(async () => {
  await clearDb();
  fakeClient = new FakeGoogleWorkspaceAdminClient();
  originalDomain = process.env.GOOGLE_STUDENT_DOMAIN;
  process.env.GOOGLE_STUDENT_DOMAIN = STUDENT_DOMAIN;
});

afterEach(async () => {
  if (originalDomain !== undefined) {
    process.env.GOOGLE_STUDENT_DOMAIN = originalDomain;
  } else {
    delete process.env.GOOGLE_STUDENT_DOMAIN;
  }
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('WorkspaceProvisioningService.provision — happy path', () => {
  it('creates an active ExternalAccount with the Google user id', async () => {
    const cohort = await makeCohort({ google_ou_path: '/Students/Spring2025' });
    const student = await makeUser({ role: 'student', cohort_id: cohort.id, display_name: 'Alice Smith' });
    const admin = await makeUser({ role: 'admin' });

    const svc = makeService(fakeClient);
    const account = await runInTransaction((tx) => svc.provision(student.id, admin.id, tx));

    expect(account.user_id).toBe(student.id);
    expect(account.type).toBe('workspace');
    expect(account.status).toBe('active');
    expect(account.external_id).toBe('fake-gws-user-id');
    expect(account.status_changed_at).not.toBeNull();
  });

  it('calls googleClient.createUser with correct arguments', async () => {
    const cohort = await makeCohort({ google_ou_path: '/Students/Spring2025' });
    const student = await makeUser({
      role: 'student',
      cohort_id: cohort.id,
      display_name: 'Alice Smith',
    });
    const admin = await makeUser({ role: 'admin' });

    const svc = makeService(fakeClient);
    await runInTransaction((tx) => svc.provision(student.id, admin.id, tx));

    expect(fakeClient.calls.createUser).toHaveLength(1);
    const callArgs = fakeClient.calls.createUser[0];
    expect(callArgs.primaryEmail).toBe(`alice.smith@${STUDENT_DOMAIN}`);
    expect(callArgs.orgUnitPath).toBe('/Students/Spring2025');
    expect(callArgs.givenName).toBe('Alice');
    expect(callArgs.familyName).toBe('Smith');
    expect(callArgs.sendNotificationEmail).toBe(true);
  });

  it('records a provision_workspace audit event with correct details', async () => {
    const cohort = await makeCohort({ google_ou_path: '/Students/Spring2025' });
    const student = await makeUser({ role: 'student', cohort_id: cohort.id, display_name: 'Alice Smith' });
    const admin = await makeUser({ role: 'admin' });

    const svc = makeService(fakeClient);
    const account = await runInTransaction((tx) => svc.provision(student.id, admin.id, tx));

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'provision_workspace', target_user_id: student.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(admin.id);
    expect(events[0].target_entity_type).toBe('ExternalAccount');
    expect(events[0].target_entity_id).toBe(String(account.id));
    expect(events[0].details).toMatchObject({
      email: `alice.smith@${STUDENT_DOMAIN}`,
      googleUserId: 'fake-gws-user-id',
    });
  });

  it('calls pike13WritebackStub.leagueEmail with userId and email', async () => {
    const cohort = await makeCohort({ google_ou_path: '/Students/Spring2025' });
    const student = await makeUser({ role: 'student', cohort_id: cohort.id, display_name: 'Alice Smith' });
    const admin = await makeUser({ role: 'admin' });

    const spy = vi.spyOn(pike13WritebackStub, 'leagueEmail');

    const svc = makeService(fakeClient);
    await runInTransaction((tx) => svc.provision(student.id, admin.id, tx));

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(student.id, `alice.smith@${STUDENT_DOMAIN}`);
  });

  it('returns the created ExternalAccount', async () => {
    const cohort = await makeCohort({ google_ou_path: '/Students/Spring2025' });
    const student = await makeUser({ role: 'student', cohort_id: cohort.id });
    const admin = await makeUser({ role: 'admin' });

    const svc = makeService(fakeClient);
    const account = await runInTransaction((tx) => svc.provision(student.id, admin.id, tx));

    expect(account).toBeDefined();
    expect(account.id).toBeGreaterThan(0);
  });

  it('uses the google user id from the client response as external_id', async () => {
    const cohort = await makeCohort({ google_ou_path: '/Students/Spring2025' });
    const student = await makeUser({ role: 'student', cohort_id: cohort.id });
    const admin = await makeUser({ role: 'admin' });

    fakeClient.configure('createUser', { id: 'custom-google-id-123', primaryEmail: `student@${STUDENT_DOMAIN}` });

    const svc = makeService(fakeClient);
    const account = await runInTransaction((tx) => svc.provision(student.id, admin.id, tx));

    expect(account.external_id).toBe('custom-google-id-123');
  });
});

// ---------------------------------------------------------------------------
// Precondition failures — no API call made
// ---------------------------------------------------------------------------

describe('WorkspaceProvisioningService.provision — non-student role', () => {
  it('throws UnprocessableError for role=staff', async () => {
    const student = await makeUser({ role: 'staff' });
    const admin = await makeUser({ role: 'admin' });
    const svc = makeService(fakeClient);

    await expect(
      runInTransaction((tx) => svc.provision(student.id, admin.id, tx)),
    ).rejects.toThrow(UnprocessableError);

    expect(fakeClient.calls.createUser).toHaveLength(0);
  });

  it('throws UnprocessableError for role=admin', async () => {
    const user = await makeUser({ role: 'admin' });
    const svc = makeService(fakeClient);

    await expect(
      runInTransaction((tx) => svc.provision(user.id, user.id, tx)),
    ).rejects.toThrow(UnprocessableError);

    expect(fakeClient.calls.createUser).toHaveLength(0);
  });
});

describe('WorkspaceProvisioningService.provision — no cohort assigned', () => {
  it('throws UnprocessableError when user has no cohort_id', async () => {
    const student = await makeUser({ role: 'student', cohort_id: null });
    const admin = await makeUser({ role: 'admin' });
    const svc = makeService(fakeClient);

    await expect(
      runInTransaction((tx) => svc.provision(student.id, admin.id, tx)),
    ).rejects.toThrow(UnprocessableError);

    expect(fakeClient.calls.createUser).toHaveLength(0);
  });
});

describe('WorkspaceProvisioningService.provision — cohort without google_ou_path', () => {
  it('throws UnprocessableError when cohort has null google_ou_path', async () => {
    const cohort = await makeCohort({ google_ou_path: null });
    const student = await makeUser({ role: 'student', cohort_id: cohort.id });
    const admin = await makeUser({ role: 'admin' });
    const svc = makeService(fakeClient);

    await expect(
      runInTransaction((tx) => svc.provision(student.id, admin.id, tx)),
    ).rejects.toThrow(UnprocessableError);

    expect(fakeClient.calls.createUser).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Conflict — existing active/pending workspace ExternalAccount
// ---------------------------------------------------------------------------

describe('WorkspaceProvisioningService.provision — existing workspace account', () => {
  it('throws ConflictError when user already has an active workspace account', async () => {
    const cohort = await makeCohort({ google_ou_path: '/Students/Spring2025' });
    const student = await makeUser({ role: 'student', cohort_id: cohort.id });
    const admin = await makeUser({ role: 'admin' });
    await makeExternalAccount(student, { type: 'workspace', status: 'active' });

    const svc = makeService(fakeClient);

    await expect(
      runInTransaction((tx) => svc.provision(student.id, admin.id, tx)),
    ).rejects.toThrow(ConflictError);

    expect(fakeClient.calls.createUser).toHaveLength(0);
  });

  it('throws ConflictError when user already has a pending workspace account', async () => {
    const cohort = await makeCohort({ google_ou_path: '/Students/Spring2025' });
    const student = await makeUser({ role: 'student', cohort_id: cohort.id });
    const admin = await makeUser({ role: 'admin' });
    await makeExternalAccount(student, { type: 'workspace', status: 'pending' });

    const svc = makeService(fakeClient);

    await expect(
      runInTransaction((tx) => svc.provision(student.id, admin.id, tx)),
    ).rejects.toThrow(ConflictError);

    expect(fakeClient.calls.createUser).toHaveLength(0);
  });

  it('allows provisioning when only a suspended workspace account exists', async () => {
    const cohort = await makeCohort({ google_ou_path: '/Students/Spring2025' });
    const student = await makeUser({ role: 'student', cohort_id: cohort.id });
    const admin = await makeUser({ role: 'admin' });
    await makeExternalAccount(student, { type: 'workspace', status: 'suspended' });

    const svc = makeService(fakeClient);
    const account = await runInTransaction((tx) => svc.provision(student.id, admin.id, tx));

    expect(account.status).toBe('active');
    expect(fakeClient.calls.createUser).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Google client errors — no ExternalAccount row created
// ---------------------------------------------------------------------------

describe('WorkspaceProvisioningService.provision — workspace client throws', () => {
  it('propagates WorkspaceApiError and does not create an ExternalAccount', async () => {
    const cohort = await makeCohort({ google_ou_path: '/Students/Spring2025' });
    const student = await makeUser({ role: 'student', cohort_id: cohort.id });
    const admin = await makeUser({ role: 'admin' });

    fakeClient.configureError(
      'createUser',
      new WorkspaceApiError('API failure', 'createUser', 500),
    );

    const svc = makeService(fakeClient);

    await expect(
      runInTransaction((tx) => svc.provision(student.id, admin.id, tx)),
    ).rejects.toThrow(WorkspaceApiError);

    // No ExternalAccount should have been persisted
    const accounts = await (prisma as any).externalAccount.findMany({
      where: { user_id: student.id },
    });
    expect(accounts).toHaveLength(0);

    // No audit event should have been persisted
    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'provision_workspace', target_user_id: student.id },
    });
    expect(events).toHaveLength(0);
  });

  it('propagates WorkspaceDomainGuardError and does not create an ExternalAccount', async () => {
    const cohort = await makeCohort({ google_ou_path: '/Students/Spring2025' });
    const student = await makeUser({ role: 'student', cohort_id: cohort.id });
    const admin = await makeUser({ role: 'admin' });

    fakeClient.configureError(
      'createUser',
      new WorkspaceDomainGuardError('domain not allowed'),
    );

    const svc = makeService(fakeClient);

    await expect(
      runInTransaction((tx) => svc.provision(student.id, admin.id, tx)),
    ).rejects.toThrow(WorkspaceDomainGuardError);

    const accounts = await (prisma as any).externalAccount.findMany({
      where: { user_id: student.id },
    });
    expect(accounts).toHaveLength(0);
  });

  it('propagates WorkspaceWriteDisabledError and does not create an ExternalAccount', async () => {
    const cohort = await makeCohort({ google_ou_path: '/Students/Spring2025' });
    const student = await makeUser({ role: 'student', cohort_id: cohort.id });
    const admin = await makeUser({ role: 'admin' });

    fakeClient.configureError('createUser', new WorkspaceWriteDisabledError());

    const svc = makeService(fakeClient);

    await expect(
      runInTransaction((tx) => svc.provision(student.id, admin.id, tx)),
    ).rejects.toThrow(WorkspaceWriteDisabledError);

    const accounts = await (prisma as any).externalAccount.findMany({
      where: { user_id: student.id },
    });
    expect(accounts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Missing environment variable
// ---------------------------------------------------------------------------

describe('WorkspaceProvisioningService.provision — GOOGLE_STUDENT_DOMAIN missing', () => {
  it('throws UnprocessableError when GOOGLE_STUDENT_DOMAIN is not set', async () => {
    delete process.env.GOOGLE_STUDENT_DOMAIN;

    const cohort = await makeCohort({ google_ou_path: '/Students/Spring2025' });
    const student = await makeUser({ role: 'student', cohort_id: cohort.id });
    const admin = await makeUser({ role: 'admin' });

    const svc = makeService(fakeClient);

    await expect(
      runInTransaction((tx) => svc.provision(student.id, admin.id, tx)),
    ).rejects.toThrow(UnprocessableError);

    expect(fakeClient.calls.createUser).toHaveLength(0);
  });
});
