/**
 * Integration tests for ClaudeProvisioningService (Sprint 005, T004).
 *
 * Covers:
 *  - Happy path: ExternalAccount created, audit event recorded, inviteMember
 *    called with workspace email (from workspaceAccount.external_id).
 *  - No active workspace ExternalAccount → UnprocessableError, no API call.
 *  - Workspace account has null external_id → UnprocessableError, no API call.
 *  - User not found → UnprocessableError, no API call.
 *  - Claude account already exists (active) → ConflictError, no API call.
 *  - Claude account already exists (pending) → ConflictError, no API call.
 *  - Suspended workspace account does not satisfy the hard gate →
 *    UnprocessableError, no API call.
 *  - API failure (ClaudeTeamApiError) → no ExternalAccount created, no audit event.
 *  - API failure (ClaudeTeamWriteDisabledError) → propagates.
 */

import { prisma } from '../../../server/src/services/prisma.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { ClaudeProvisioningService } from '../../../server/src/services/claude-provisioning.service.js';
import { ExternalAccountRepository } from '../../../server/src/services/repositories/external-account.repository.js';
import { UserRepository } from '../../../server/src/services/repositories/user.repository.js';
import {
  ClaudeTeamApiError,
  ClaudeTeamWriteDisabledError,
} from '../../../server/src/services/claude-team/claude-team-admin.client.js';
import { ConflictError, UnprocessableError } from '../../../server/src/errors.js';
import { FakeClaudeTeamAdminClient } from '../helpers/fake-claude-team-admin.client.js';
import { makeUser, makeExternalAccount } from '../helpers/factories.js';
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

function makeService(fake: FakeClaudeTeamAdminClient): ClaudeProvisioningService {
  return new ClaudeProvisioningService(
    fake,
    ExternalAccountRepository,
    new AuditService(),
    UserRepository,
  );
}

/**
 * Run the service inside a real prisma.$transaction so the tx parameter
 * is a genuine TransactionClient. Mirrors how callers will invoke it.
 */
async function runInTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return (prisma as any).$transaction(fn);
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let fakeClient: FakeClaudeTeamAdminClient;

beforeEach(async () => {
  await clearDb();
  fakeClient = new FakeClaudeTeamAdminClient();
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('ClaudeProvisioningService.provision — happy path', () => {
  it('creates a pending ExternalAccount with the Claude invite id', async () => {
    const student = await makeUser({ role: 'student' });
    const admin = await makeUser({ role: 'admin' });
    // Workspace account whose external_id is the workspace email
    await makeExternalAccount(student, {
      type: 'workspace',
      status: 'active',
      external_id: 'alice.smith@students.jointheleague.org',
    });

    const svc = makeService(fakeClient);
    const account = await runInTransaction((tx) => svc.provision(student.id, admin.id, tx));

    expect(account.user_id).toBe(student.id);
    expect(account.type).toBe('claude');
    // Invite creates a pending seat; transitions to active once accepted via reconcile
    expect(account.status).toBe('pending');
    expect(account.external_id).toBe('fake-claude-member-id');
    expect(account.status_changed_at).not.toBeNull();
  });

  it('calls inviteMember with the workspace email from workspaceAccount.external_id', async () => {
    const workspaceEmail = 'bob.jones@students.jointheleague.org';
    const student = await makeUser({ role: 'student' });
    const admin = await makeUser({ role: 'admin' });
    await makeExternalAccount(student, {
      type: 'workspace',
      status: 'active',
      external_id: workspaceEmail,
    });

    const svc = makeService(fakeClient);
    await runInTransaction((tx) => svc.provision(student.id, admin.id, tx));

    expect(fakeClient.calls.inviteMember).toHaveLength(1);
    expect(fakeClient.calls.inviteMember[0].email).toBe(workspaceEmail);
  });

  it('records a provision_claude audit event with correct fields', async () => {
    const workspaceEmail = 'carol.white@students.jointheleague.org';
    const student = await makeUser({ role: 'student' });
    const admin = await makeUser({ role: 'admin' });
    await makeExternalAccount(student, {
      type: 'workspace',
      status: 'active',
      external_id: workspaceEmail,
    });

    const svc = makeService(fakeClient);
    const account = await runInTransaction((tx) => svc.provision(student.id, admin.id, tx));

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'provision_claude', target_user_id: student.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(admin.id);
    expect(events[0].target_entity_type).toBe('ExternalAccount');
    expect(events[0].target_entity_id).toBe(String(account.id));
    expect(events[0].details).toMatchObject({
      workspaceEmail,
      claudeMemberId: 'fake-claude-member-id',
    });
  });

  it('returns the created ExternalAccount', async () => {
    const student = await makeUser({ role: 'student' });
    const admin = await makeUser({ role: 'admin' });
    await makeExternalAccount(student, {
      type: 'workspace',
      status: 'active',
      external_id: 'student@students.jointheleague.org',
    });

    const svc = makeService(fakeClient);
    const account = await runInTransaction((tx) => svc.provision(student.id, admin.id, tx));

    expect(account).toBeDefined();
    expect(account.id).toBeGreaterThan(0);
  });

  it('uses the member id from the API response as external_id', async () => {
    const student = await makeUser({ role: 'student' });
    const admin = await makeUser({ role: 'admin' });
    await makeExternalAccount(student, {
      type: 'workspace',
      status: 'active',
      external_id: 'student@students.jointheleague.org',
    });

    fakeClient.configure('inviteMember', {
      id: 'custom-claude-member-xyz',
      email: 'student@students.jointheleague.org',
      status: 'active',
    });

    const svc = makeService(fakeClient);
    const account = await runInTransaction((tx) => svc.provision(student.id, admin.id, tx));

    expect(account.external_id).toBe('custom-claude-member-xyz');
  });
});

// ---------------------------------------------------------------------------
// Precondition failures — no API call made
// ---------------------------------------------------------------------------

describe('ClaudeProvisioningService.provision — user not found', () => {
  it('throws UnprocessableError for a non-existent userId', async () => {
    const admin = await makeUser({ role: 'admin' });
    const svc = makeService(fakeClient);

    await expect(
      runInTransaction((tx) => svc.provision(999999, admin.id, tx)),
    ).rejects.toThrow(UnprocessableError);

    expect(fakeClient.calls.inviteMember).toHaveLength(0);
  });
});

describe('ClaudeProvisioningService.provision — no active workspace account', () => {
  it('throws UnprocessableError when user has no workspace ExternalAccount', async () => {
    const student = await makeUser({ role: 'student' });
    const admin = await makeUser({ role: 'admin' });
    // No workspace account created
    const svc = makeService(fakeClient);

    await expect(
      runInTransaction((tx) => svc.provision(student.id, admin.id, tx)),
    ).rejects.toThrow(UnprocessableError);

    expect(fakeClient.calls.inviteMember).toHaveLength(0);
  });

  it('throws UnprocessableError when workspace account is suspended (not active)', async () => {
    const student = await makeUser({ role: 'student' });
    const admin = await makeUser({ role: 'admin' });
    await makeExternalAccount(student, {
      type: 'workspace',
      status: 'suspended',
      external_id: 'student@students.jointheleague.org',
    });

    const svc = makeService(fakeClient);

    await expect(
      runInTransaction((tx) => svc.provision(student.id, admin.id, tx)),
    ).rejects.toThrow(UnprocessableError);

    expect(fakeClient.calls.inviteMember).toHaveLength(0);
  });

  it('throws UnprocessableError when workspace account external_id is null', async () => {
    const student = await makeUser({ role: 'student' });
    const admin = await makeUser({ role: 'admin' });
    await makeExternalAccount(student, {
      type: 'workspace',
      status: 'active',
      external_id: null,
    });

    const svc = makeService(fakeClient);

    await expect(
      runInTransaction((tx) => svc.provision(student.id, admin.id, tx)),
    ).rejects.toThrow(UnprocessableError);

    expect(fakeClient.calls.inviteMember).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Conflict — existing active/pending claude ExternalAccount
// ---------------------------------------------------------------------------

describe('ClaudeProvisioningService.provision — existing claude account', () => {
  it('throws ConflictError when user already has an active claude account', async () => {
    const student = await makeUser({ role: 'student' });
    const admin = await makeUser({ role: 'admin' });
    await makeExternalAccount(student, {
      type: 'workspace',
      status: 'active',
      external_id: 'student@students.jointheleague.org',
    });
    await makeExternalAccount(student, { type: 'claude', status: 'active' });

    const svc = makeService(fakeClient);

    await expect(
      runInTransaction((tx) => svc.provision(student.id, admin.id, tx)),
    ).rejects.toThrow(ConflictError);

    expect(fakeClient.calls.inviteMember).toHaveLength(0);
  });

  it('throws ConflictError when user already has a pending claude account', async () => {
    const student = await makeUser({ role: 'student' });
    const admin = await makeUser({ role: 'admin' });
    await makeExternalAccount(student, {
      type: 'workspace',
      status: 'active',
      external_id: 'student@students.jointheleague.org',
    });
    await makeExternalAccount(student, { type: 'claude', status: 'pending' });

    const svc = makeService(fakeClient);

    await expect(
      runInTransaction((tx) => svc.provision(student.id, admin.id, tx)),
    ).rejects.toThrow(ConflictError);

    expect(fakeClient.calls.inviteMember).toHaveLength(0);
  });

  it('allows provisioning when only a suspended claude account exists', async () => {
    const student = await makeUser({ role: 'student' });
    const admin = await makeUser({ role: 'admin' });
    await makeExternalAccount(student, {
      type: 'workspace',
      status: 'active',
      external_id: 'student@students.jointheleague.org',
    });
    await makeExternalAccount(student, { type: 'claude', status: 'suspended' });

    const svc = makeService(fakeClient);
    const account = await runInTransaction((tx) => svc.provision(student.id, admin.id, tx));

    // Invite creates a pending seat
    expect(account.status).toBe('pending');
    expect(fakeClient.calls.inviteMember).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Claude client errors — no ExternalAccount row created
// ---------------------------------------------------------------------------

describe('ClaudeProvisioningService.provision — claude client throws', () => {
  it('propagates ClaudeTeamApiError and does not create an ExternalAccount', async () => {
    const student = await makeUser({ role: 'student' });
    const admin = await makeUser({ role: 'admin' });
    await makeExternalAccount(student, {
      type: 'workspace',
      status: 'active',
      external_id: 'student@students.jointheleague.org',
    });

    fakeClient.configureError(
      'inviteMember',
      new ClaudeTeamApiError('API failure', 'inviteMember', 500),
    );

    const svc = makeService(fakeClient);

    await expect(
      runInTransaction((tx) => svc.provision(student.id, admin.id, tx)),
    ).rejects.toThrow(ClaudeTeamApiError);

    // No claude ExternalAccount should have been persisted
    const accounts = await (prisma as any).externalAccount.findMany({
      where: { user_id: student.id, type: 'claude' },
    });
    expect(accounts).toHaveLength(0);

    // No audit event should have been persisted
    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'provision_claude', target_user_id: student.id },
    });
    expect(events).toHaveLength(0);
  });

  it('propagates ClaudeTeamWriteDisabledError and does not create an ExternalAccount', async () => {
    const student = await makeUser({ role: 'student' });
    const admin = await makeUser({ role: 'admin' });
    await makeExternalAccount(student, {
      type: 'workspace',
      status: 'active',
      external_id: 'student@students.jointheleague.org',
    });

    fakeClient.configureError('inviteMember', new ClaudeTeamWriteDisabledError());

    const svc = makeService(fakeClient);

    await expect(
      runInTransaction((tx) => svc.provision(student.id, admin.id, tx)),
    ).rejects.toThrow(ClaudeTeamWriteDisabledError);

    const accounts = await (prisma as any).externalAccount.findMany({
      where: { user_id: student.id, type: 'claude' },
    });
    expect(accounts).toHaveLength(0);
  });
});
