/**
 * Integration tests for ProvisioningRequestService (Sprint 003 T001 + Sprint 004 T007 + Sprint 005 T007).
 *
 * Covers:
 *  - create('workspace') happy path: one row, audit recorded
 *  - create('workspace') conflict: user already has pending workspace request
 *  - create('workspace') conflict: user has active workspace ExternalAccount
 *  - create('workspace_and_claude') happy path: two rows, two audit events
 *  - create('workspace_and_claude') constraint: no existing workspace baseline → 422
 *  - create('workspace_and_claude') constraint satisfied by pending workspace request → succeeds
 *  - create('workspace_and_claude') constraint satisfied by active workspace ExternalAccount → succeeds
 *  - create('claude') alone: no workspace baseline → 422
 *  - create('claude') alone: workspace ExternalAccount present → succeeds
 *  - create('claude') alone: pending workspace ProvisioningRequest present → succeeds
 *  - approve (workspace): calls WorkspaceProvisioningService.provision, status=approved, ExternalAccount created
 *  - approve (workspace): provision throws → transaction rolled back, status stays pending
 *  - approve (claude): calls ClaudeProvisioningService.provision, status=approved, ExternalAccount created
 *  - approve (claude): provision throws → transaction rolled back, status stays pending
 *  - approve (claude): claudeProvisioningService not injected → throws Error
 *  - approve (already-approved): throws ConflictError
 *  - approve (rejected): throws ConflictError
 *  - approve: throws NotFoundError for unknown request
 *  - reject: sets status, decided_by, decided_at; audit recorded; no provision call
 *  - reject: throws NotFoundError for unknown request
 *  - findByUser: returns correct rows ordered newest first
 *  - findPending: returns only pending rows ordered oldest first
 *  - Atomicity: AuditService error rolls back ProvisioningRequest creation
 */
import { prisma } from '../../../server/src/services/prisma.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { ExternalAccountService } from '../../../server/src/services/external-account.service.js';
import { ProvisioningRequestService } from '../../../server/src/services/provisioning-request.service.js';
import { WorkspaceProvisioningService } from '../../../server/src/services/workspace-provisioning.service.js';
import { ClaudeProvisioningService } from '../../../server/src/services/claude-provisioning.service.js';
import { ExternalAccountRepository } from '../../../server/src/services/repositories/external-account.repository.js';
import { UserRepository } from '../../../server/src/services/repositories/user.repository.js';
import { CohortRepository } from '../../../server/src/services/repositories/cohort.repository.js';
import { WorkspaceApiError } from '../../../server/src/services/google-workspace/google-workspace-admin.client.js';
import { ClaudeTeamApiError } from '../../../server/src/services/claude-team/claude-team-admin.client.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../../../server/src/errors.js';
import { FakeGoogleWorkspaceAdminClient } from '../helpers/fake-google-workspace-admin.client.js';
import { FakeClaudeTeamAdminClient } from '../helpers/fake-claude-team-admin.client.js';
import { vi } from 'vitest';
import {
  makeCohort,
  makeUser,
  makeExternalAccount,
  makeProvisioningRequest,
} from '../helpers/factories.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STUDENT_DOMAIN = 'students.jointheleague.org';

async function clearDb() {
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

function makeWorkspaceProvisioningService(
  fake: FakeGoogleWorkspaceAdminClient,
): WorkspaceProvisioningService {
  return new WorkspaceProvisioningService(
    fake,
    ExternalAccountRepository,
    new AuditService(),
    UserRepository,
    CohortRepository,
  );
}

function makeClaudeProvisioningService(
  fake: FakeClaudeTeamAdminClient,
): ClaudeProvisioningService {
  return new ClaudeProvisioningService(
    fake,
    ExternalAccountRepository,
    new AuditService(),
    UserRepository,
  );
}

function makeService(
  auditOverride?: AuditService,
  workspaceProvSvc?: WorkspaceProvisioningService,
  claudeProvSvc?: ClaudeProvisioningService,
): ProvisioningRequestService {
  const audit = auditOverride ?? new AuditService();
  const externalAccounts = new ExternalAccountService(prisma, audit);
  return new ProvisioningRequestService(prisma, audit, externalAccounts, workspaceProvSvc, claudeProvSvc);
}

let fakeClient: FakeGoogleWorkspaceAdminClient;
let fakeClaudeClient: FakeClaudeTeamAdminClient;
let originalDomain: string | undefined;

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await clearDb();
  fakeClient = new FakeGoogleWorkspaceAdminClient();
  fakeClaudeClient = new FakeClaudeTeamAdminClient();
  originalDomain = process.env.GOOGLE_STUDENT_DOMAIN;
  process.env.GOOGLE_STUDENT_DOMAIN = STUDENT_DOMAIN;
});

afterEach(() => {
  if (originalDomain !== undefined) {
    process.env.GOOGLE_STUDENT_DOMAIN = originalDomain;
  } else {
    delete process.env.GOOGLE_STUDENT_DOMAIN;
  }
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// create — workspace
// ---------------------------------------------------------------------------

describe('ProvisioningRequestService.create — workspace', () => {
  it('creates a single pending workspace row and records an audit event', async () => {
    const user = await makeUser();
    const admin = await makeUser();
    const svc = makeService();

    const results = await svc.create(user.id, 'workspace', admin.id);

    expect(results).toHaveLength(1);
    expect(results[0].user_id).toBe(user.id);
    expect(results[0].requested_type).toBe('workspace');
    expect(results[0].status).toBe('pending');

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'create_provisioning_request', target_user_id: user.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0].details).toMatchObject({
      requestedType: 'workspace',
      provisioningRequestId: results[0].id,
    });
  });

  it('throws ConflictError when user already has a pending workspace request', async () => {
    const user = await makeUser();
    const svc = makeService();

    await makeProvisioningRequest(user, { requested_type: 'workspace', status: 'pending' });

    await expect(svc.create(user.id, 'workspace', user.id)).rejects.toThrow(ConflictError);
  });

  it('throws ConflictError when user already has an approved workspace request', async () => {
    const user = await makeUser();
    const svc = makeService();

    await makeProvisioningRequest(user, { requested_type: 'workspace', status: 'approved' });

    await expect(svc.create(user.id, 'workspace', user.id)).rejects.toThrow(ConflictError);
  });

  it('throws ConflictError when user already has an active workspace ExternalAccount', async () => {
    const user = await makeUser();
    const svc = makeService();

    await makeExternalAccount(user, { type: 'workspace', status: 'active' });

    await expect(svc.create(user.id, 'workspace', user.id)).rejects.toThrow(ConflictError);
  });

  it('throws ConflictError when user already has a pending workspace ExternalAccount', async () => {
    const user = await makeUser();
    const svc = makeService();

    await makeExternalAccount(user, { type: 'workspace', status: 'pending' });

    await expect(svc.create(user.id, 'workspace', user.id)).rejects.toThrow(ConflictError);
  });

  it('allows creating a workspace request when only a rejected workspace request exists', async () => {
    const user = await makeUser();
    const svc = makeService();

    await makeProvisioningRequest(user, { requested_type: 'workspace', status: 'rejected' });

    const results = await svc.create(user.id, 'workspace', user.id);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// create — workspace_and_claude
// ---------------------------------------------------------------------------

describe('ProvisioningRequestService.create — workspace_and_claude', () => {
  it('creates two rows atomically and records two audit events', async () => {
    const user = await makeUser();
    const svc = makeService();

    const results = await svc.create(user.id, 'workspace_and_claude', user.id);

    expect(results).toHaveLength(2);

    const types = results.map((r) => r.requested_type).sort();
    expect(types).toEqual(['claude', 'workspace']);
    results.forEach((r) => {
      expect(r.user_id).toBe(user.id);
      expect(r.status).toBe('pending');
    });

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'create_provisioning_request', target_user_id: user.id },
      orderBy: { id: 'asc' },
    });
    expect(events).toHaveLength(2);
    const eventTypes = events.map((e: any) => e.details.requestedType).sort();
    expect(eventTypes).toEqual(['claude', 'workspace']);
  });

  it('throws ConflictError when user already has a pending workspace request', async () => {
    const user = await makeUser();
    const svc = makeService();

    await makeProvisioningRequest(user, { requested_type: 'workspace', status: 'pending' });

    await expect(svc.create(user.id, 'workspace_and_claude', user.id)).rejects.toThrow(
      ConflictError,
    );
  });

  it('throws ConflictError when user already has an active workspace ExternalAccount', async () => {
    const user = await makeUser();
    const svc = makeService();

    await makeExternalAccount(user, { type: 'workspace', status: 'active' });

    await expect(svc.create(user.id, 'workspace_and_claude', user.id)).rejects.toThrow(
      ConflictError,
    );
  });
});

// ---------------------------------------------------------------------------
// create — claude alone
// ---------------------------------------------------------------------------

describe('ProvisioningRequestService.create — claude alone', () => {
  it('throws UnprocessableError when user has no workspace baseline', async () => {
    const user = await makeUser();
    const svc = makeService();

    await expect(svc.create(user.id, 'claude', user.id)).rejects.toThrow(UnprocessableError);
  });

  it('succeeds when user has an active workspace ExternalAccount', async () => {
    const user = await makeUser();
    const svc = makeService();

    await makeExternalAccount(user, { type: 'workspace', status: 'active' });

    const results = await svc.create(user.id, 'claude', user.id);
    expect(results).toHaveLength(1);
    expect(results[0].requested_type).toBe('claude');
    expect(results[0].status).toBe('pending');
  });

  it('succeeds when user has a pending workspace ExternalAccount', async () => {
    const user = await makeUser();
    const svc = makeService();

    await makeExternalAccount(user, { type: 'workspace', status: 'pending' });

    const results = await svc.create(user.id, 'claude', user.id);
    expect(results).toHaveLength(1);
    expect(results[0].requested_type).toBe('claude');
  });

  it('succeeds when user has a pending workspace ProvisioningRequest', async () => {
    const user = await makeUser();
    const svc = makeService();

    await makeProvisioningRequest(user, { requested_type: 'workspace', status: 'pending' });

    const results = await svc.create(user.id, 'claude', user.id);
    expect(results).toHaveLength(1);
    expect(results[0].requested_type).toBe('claude');
  });

  it('succeeds when user has an approved workspace ProvisioningRequest', async () => {
    const user = await makeUser();
    const svc = makeService();

    await makeProvisioningRequest(user, { requested_type: 'workspace', status: 'approved' });

    const results = await svc.create(user.id, 'claude', user.id);
    expect(results).toHaveLength(1);
    expect(results[0].requested_type).toBe('claude');
  });

  it('throws UnprocessableError when only a rejected workspace request exists', async () => {
    const user = await makeUser();
    const svc = makeService();

    await makeProvisioningRequest(user, { requested_type: 'workspace', status: 'rejected' });

    await expect(svc.create(user.id, 'claude', user.id)).rejects.toThrow(UnprocessableError);
  });
});

// ---------------------------------------------------------------------------
// Atomicity — transaction rollback
// ---------------------------------------------------------------------------

describe('ProvisioningRequestService.create — atomicity', () => {
  it('rolls back ProvisioningRequest creation if AuditService.record throws', async () => {
    const user = await makeUser();

    // Create a broken audit service that throws on record
    const brokenAudit = new AuditService();
    vi.spyOn(brokenAudit, 'record').mockRejectedValue(new Error('audit failure'));

    const externalAccounts = new ExternalAccountService(prisma, brokenAudit);
    const svc = new ProvisioningRequestService(prisma, brokenAudit, externalAccounts);

    await expect(svc.create(user.id, 'workspace', user.id)).rejects.toThrow('audit failure');

    // No ProvisioningRequest should have been persisted
    const rows = await (prisma as any).provisioningRequest.findMany({
      where: { user_id: user.id },
    });
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// approve — workspace request wired to WorkspaceProvisioningService (T007)
// ---------------------------------------------------------------------------

describe('ProvisioningRequestService.approve — workspace request', () => {
  it('sets status=approved, decided_by, decided_at and creates ExternalAccount', async () => {
    const cohort = await makeCohort({ google_ou_path: '/Students/TestCohort' });
    const user = await makeUser({ role: 'student', cohort_id: cohort.id });
    const admin = await makeUser({ role: 'staff' });
    const svc = makeService(undefined, makeWorkspaceProvisioningService(fakeClient));

    const req = await makeProvisioningRequest(user, { requested_type: 'workspace' });

    const updated = await svc.approve(req.id, admin.id);

    expect(updated.status).toBe('approved');
    expect(updated.decided_by).toBe(admin.id);
    expect(updated.decided_at).toBeDefined();
    expect(updated.decided_at).not.toBeNull();

    // ExternalAccount should have been created by WorkspaceProvisioningService
    const accounts = await (prisma as any).externalAccount.findMany({
      where: { user_id: user.id, type: 'workspace' },
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0].status).toBe('active');
    // external_id on workspace rows is the League email, not the Google user id.
    expect(accounts[0].external_id).toMatch(/@students\.jointheleague\.org$/);
  });

  it('records an approve_provisioning_request audit event', async () => {
    const cohort = await makeCohort({ google_ou_path: '/Students/TestCohort' });
    const user = await makeUser({ role: 'student', cohort_id: cohort.id });
    const admin = await makeUser({ role: 'staff' });
    const svc = makeService(undefined, makeWorkspaceProvisioningService(fakeClient));

    const req = await makeProvisioningRequest(user, { requested_type: 'workspace' });

    await svc.approve(req.id, admin.id);

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'approve_provisioning_request', target_entity_id: String(req.id) },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(admin.id);
    expect(events[0].target_user_id).toBe(user.id);
  });

  it('calls GoogleWorkspaceAdminClient.createUser with correct params', async () => {
    const cohort = await makeCohort({ google_ou_path: '/Students/TestCohort' });
    const user = await makeUser({ role: 'student', cohort_id: cohort.id, display_name: 'Alice Smith' });
    const admin = await makeUser({ role: 'staff' });
    const svc = makeService(undefined, makeWorkspaceProvisioningService(fakeClient));

    const req = await makeProvisioningRequest(user, { requested_type: 'workspace' });
    await svc.approve(req.id, admin.id);

    expect(fakeClient.calls.createUser).toHaveLength(1);
    const call = fakeClient.calls.createUser[0];
    expect(call.primaryEmail).toContain(`@${STUDENT_DOMAIN}`);
    expect(call.orgUnitPath).toBe('/Students/TestCohort');
  });

  it('rolls back entire transaction when WorkspaceProvisioningService.provision throws', async () => {
    const cohort = await makeCohort({ google_ou_path: '/Students/TestCohort' });
    const user = await makeUser({ role: 'student', cohort_id: cohort.id });
    const admin = await makeUser({ role: 'staff' });

    fakeClient.configureError('createUser', new WorkspaceApiError('SDK error', 'createUser', 500));
    const svc = makeService(undefined, makeWorkspaceProvisioningService(fakeClient));

    const req = await makeProvisioningRequest(user, { requested_type: 'workspace' });

    await expect(svc.approve(req.id, admin.id)).rejects.toThrow(WorkspaceApiError);

    // Request should still be pending — transaction rolled back
    const stillPending = await (prisma as any).provisioningRequest.findUnique({
      where: { id: req.id },
    });
    expect(stillPending.status).toBe('pending');

    // No ExternalAccount should have been created
    const accounts = await (prisma as any).externalAccount.findMany({
      where: { user_id: user.id, type: 'workspace' },
    });
    expect(accounts).toHaveLength(0);

    // No audit event should exist for this approval attempt
    const approveEvents = await (prisma as any).auditEvent.findMany({
      where: { action: 'approve_provisioning_request', target_entity_id: String(req.id) },
    });
    expect(approveEvents).toHaveLength(0);
  });

  it('throws ConflictError when request is already approved', async () => {
    const user = await makeUser({ role: 'student' });
    const admin = await makeUser({ role: 'staff' });
    const svc = makeService(undefined, makeWorkspaceProvisioningService(fakeClient));

    const req = await makeProvisioningRequest(user, { requested_type: 'workspace', status: 'approved' });

    await expect(svc.approve(req.id, admin.id)).rejects.toThrow(ConflictError);
  });

  it('throws ConflictError when request is already rejected', async () => {
    const user = await makeUser({ role: 'student' });
    const admin = await makeUser({ role: 'staff' });
    const svc = makeService(undefined, makeWorkspaceProvisioningService(fakeClient));

    const req = await makeProvisioningRequest(user, { requested_type: 'workspace', status: 'rejected' });

    await expect(svc.approve(req.id, admin.id)).rejects.toThrow(ConflictError);
  });

  it('throws NotFoundError for an unknown request id', async () => {
    const svc = makeService(undefined, makeWorkspaceProvisioningService(fakeClient));
    await expect(svc.approve(9999999, 1)).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// approve — claude request wired to ClaudeProvisioningService (Sprint 005 T007)
// ---------------------------------------------------------------------------

describe('ProvisioningRequestService.approve — claude request', () => {
  it('sets status=approved, decided_by, decided_at and creates ExternalAccount', async () => {
    const user = await makeUser({ role: 'student' });
    const admin = await makeUser({ role: 'staff' });
    // Give the user an active workspace account (hard gate for ClaudeProvisioningService)
    await makeExternalAccount(user, {
      type: 'workspace',
      status: 'active',
      external_id: 'alice@students.jointheleague.org',
    });
    const svc = makeService(
      undefined,
      makeWorkspaceProvisioningService(fakeClient),
      makeClaudeProvisioningService(fakeClaudeClient),
    );

    const req = await makeProvisioningRequest(user, { requested_type: 'claude' });

    const updated = await svc.approve(req.id, admin.id);

    expect(updated.status).toBe('approved');
    expect(updated.decided_by).toBe(admin.id);
    expect(updated.decided_at).not.toBeNull();

    // ExternalAccount should have been created by ClaudeProvisioningService
    const accounts = await (prisma as any).externalAccount.findMany({
      where: { user_id: user.id, type: 'claude' },
    });
    expect(accounts).toHaveLength(1);
    // Invite creates a pending seat; transitions to active once invite is accepted
    expect(accounts[0].status).toBe('pending');
    expect(accounts[0].external_id).toBe('fake-claude-member-id');
  });

  it('records an approve_provisioning_request audit event for claude', async () => {
    const user = await makeUser({ role: 'student' });
    const admin = await makeUser({ role: 'staff' });
    await makeExternalAccount(user, {
      type: 'workspace',
      status: 'active',
      external_id: 'alice@students.jointheleague.org',
    });
    const svc = makeService(
      undefined,
      makeWorkspaceProvisioningService(fakeClient),
      makeClaudeProvisioningService(fakeClaudeClient),
    );

    const req = await makeProvisioningRequest(user, { requested_type: 'claude' });
    await svc.approve(req.id, admin.id);

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'approve_provisioning_request', target_entity_id: String(req.id) },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(admin.id);
    expect(events[0].target_user_id).toBe(user.id);
  });

  it('calls ClaudeTeamAdminClient.inviteMember with the workspace email', async () => {
    const user = await makeUser({ role: 'student' });
    const admin = await makeUser({ role: 'staff' });
    await makeExternalAccount(user, {
      type: 'workspace',
      status: 'active',
      external_id: 'alice@students.jointheleague.org',
    });
    const svc = makeService(
      undefined,
      makeWorkspaceProvisioningService(fakeClient),
      makeClaudeProvisioningService(fakeClaudeClient),
    );

    const req = await makeProvisioningRequest(user, { requested_type: 'claude' });
    await svc.approve(req.id, admin.id);

    expect(fakeClaudeClient.calls.inviteMember).toHaveLength(1);
    expect(fakeClaudeClient.calls.inviteMember[0].email).toBe(
      'alice@students.jointheleague.org',
    );
    // No Google Workspace API call should have been made
    expect(fakeClient.calls.createUser).toHaveLength(0);
  });

  it('rolls back entire transaction when ClaudeProvisioningService.provision throws', async () => {
    const user = await makeUser({ role: 'student' });
    const admin = await makeUser({ role: 'staff' });
    await makeExternalAccount(user, {
      type: 'workspace',
      status: 'active',
      external_id: 'alice@students.jointheleague.org',
    });

    fakeClaudeClient.configureError(
      'inviteMember',
      new ClaudeTeamApiError('SDK error', 'inviteMember', 500),
    );
    const svc = makeService(
      undefined,
      makeWorkspaceProvisioningService(fakeClient),
      makeClaudeProvisioningService(fakeClaudeClient),
    );

    const req = await makeProvisioningRequest(user, { requested_type: 'claude' });

    await expect(svc.approve(req.id, admin.id)).rejects.toThrow(ClaudeTeamApiError);

    // Request should still be pending — transaction rolled back
    const stillPending = await (prisma as any).provisioningRequest.findUnique({
      where: { id: req.id },
    });
    expect(stillPending.status).toBe('pending');

    // No claude ExternalAccount should have been created
    const accounts = await (prisma as any).externalAccount.findMany({
      where: { user_id: user.id, type: 'claude' },
    });
    expect(accounts).toHaveLength(0);

    // No audit event should exist for this approval attempt
    const approveEvents = await (prisma as any).auditEvent.findMany({
      where: { action: 'approve_provisioning_request', target_entity_id: String(req.id) },
    });
    expect(approveEvents).toHaveLength(0);
  });

  it('throws Error when claudeProvisioningService is not injected', async () => {
    const user = await makeUser({ role: 'student' });
    const admin = await makeUser({ role: 'staff' });
    await makeExternalAccount(user, {
      type: 'workspace',
      status: 'active',
      external_id: 'alice@students.jointheleague.org',
    });
    // Construct service without claudeProvisioningService
    const svc = makeService(undefined, makeWorkspaceProvisioningService(fakeClient));

    const req = await makeProvisioningRequest(user, { requested_type: 'claude' });

    await expect(svc.approve(req.id, admin.id)).rejects.toThrow(
      'claudeProvisioningService is required',
    );

    // Request should still be pending
    const stillPending = await (prisma as any).provisioningRequest.findUnique({
      where: { id: req.id },
    });
    expect(stillPending.status).toBe('pending');
  });

  it('auto-chains workspace then claude when student has no active workspace ExternalAccount', async () => {
    const cohort = await makeCohort({ google_ou_path: '/Students/AutoChain' });
    const user = await makeUser({ role: 'student', cohort_id: cohort.id });
    const admin = await makeUser({ role: 'staff' });
    // No workspace ExternalAccount — this is the auto-chain scenario.
    const svc = makeService(
      undefined,
      makeWorkspaceProvisioningService(fakeClient),
      makeClaudeProvisioningService(fakeClaudeClient),
    );

    const req = await makeProvisioningRequest(user, { requested_type: 'claude' });

    const updated = await svc.approve(req.id, admin.id);

    expect(updated.status).toBe('approved');

    // Both a workspace and a claude ExternalAccount should have been created.
    const workspaceAccounts = await (prisma as any).externalAccount.findMany({
      where: { user_id: user.id, type: 'workspace' },
    });
    expect(workspaceAccounts).toHaveLength(1);
    expect(workspaceAccounts[0].status).toBe('active');

    const claudeAccounts = await (prisma as any).externalAccount.findMany({
      where: { user_id: user.id, type: 'claude' },
    });
    expect(claudeAccounts).toHaveLength(1);
    // Invite creates a pending seat; transitions to active once invite is accepted
    expect(claudeAccounts[0].status).toBe('pending');

    // The audit event should carry auto_chained: true.
    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'approve_provisioning_request', target_entity_id: String(req.id) },
    });
    expect(events).toHaveLength(1);
    expect(events[0].details).toMatchObject({ auto_chained: true, requestedType: 'claude' });
  });

  it('does NOT auto-chain when student already has an active workspace ExternalAccount', async () => {
    const user = await makeUser({ role: 'student' });
    const admin = await makeUser({ role: 'staff' });
    await makeExternalAccount(user, {
      type: 'workspace',
      status: 'active',
      external_id: 'alice@students.jointheleague.org',
    });
    const svc = makeService(
      undefined,
      makeWorkspaceProvisioningService(fakeClient),
      makeClaudeProvisioningService(fakeClaudeClient),
    );

    const req = await makeProvisioningRequest(user, { requested_type: 'claude' });
    await svc.approve(req.id, admin.id);

    // Only one workspace account — no second one created by auto-chain.
    const workspaceAccounts = await (prisma as any).externalAccount.findMany({
      where: { user_id: user.id, type: 'workspace' },
    });
    expect(workspaceAccounts).toHaveLength(1);

    // Audit event should NOT have auto_chained.
    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'approve_provisioning_request', target_entity_id: String(req.id) },
    });
    expect(events).toHaveLength(1);
    expect((events[0].details as any).auto_chained).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// reject
// ---------------------------------------------------------------------------

describe('ProvisioningRequestService.reject', () => {
  it('sets status=rejected, decided_by, decided_at', async () => {
    const user = await makeUser();
    const admin = await makeUser();
    const svc = makeService(undefined, makeWorkspaceProvisioningService(fakeClient));

    const req = await makeProvisioningRequest(user, { requested_type: 'workspace' });

    const updated = await svc.reject(req.id, admin.id);

    expect(updated.status).toBe('rejected');
    expect(updated.decided_by).toBe(admin.id);
    expect(updated.decided_at).toBeDefined();
    expect(updated.decided_at).not.toBeNull();
  });

  it('records a reject_provisioning_request audit event', async () => {
    const user = await makeUser();
    const admin = await makeUser();
    const svc = makeService(undefined, makeWorkspaceProvisioningService(fakeClient));

    const req = await makeProvisioningRequest(user, { requested_type: 'workspace' });

    await svc.reject(req.id, admin.id);

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'reject_provisioning_request', target_entity_id: String(req.id) },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(admin.id);
    expect(events[0].target_user_id).toBe(user.id);
  });

  it('does not call WorkspaceProvisioningService on reject', async () => {
    const user = await makeUser({ role: 'student' });
    const admin = await makeUser({ role: 'staff' });
    const svc = makeService(undefined, makeWorkspaceProvisioningService(fakeClient));

    const req = await makeProvisioningRequest(user, { requested_type: 'workspace' });
    await svc.reject(req.id, admin.id);

    expect(fakeClient.calls.createUser).toHaveLength(0);
  });

  it('throws NotFoundError for an unknown request id', async () => {
    const svc = makeService(undefined, makeWorkspaceProvisioningService(fakeClient));
    await expect(svc.reject(9999999, 1)).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// findByUser
// ---------------------------------------------------------------------------

describe('ProvisioningRequestService.findByUser', () => {
  it('returns only the target user requests (not other users)', async () => {
    const user = await makeUser();
    const other = await makeUser();
    const svc = makeService();

    const r1 = await makeProvisioningRequest(user, { requested_type: 'workspace' });
    const r2 = await makeProvisioningRequest(user, { requested_type: 'claude' });
    await makeProvisioningRequest(other, { requested_type: 'workspace' }); // different user

    const results = await svc.findByUser(user.id);

    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.id);
    expect(ids).toContain(r1.id);
    expect(ids).toContain(r2.id);
    // ordering is newest-first; verify the sort direction is desc
    expect(results[0].created_at >= results[1].created_at).toBe(true);
  });

  it('returns an empty array when user has no requests', async () => {
    const user = await makeUser();
    const svc = makeService();

    const results = await svc.findByUser(user.id);
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findPending
// ---------------------------------------------------------------------------

describe('ProvisioningRequestService.findPending', () => {
  it('returns only pending requests, oldest first', async () => {
    const user = await makeUser();
    const svc = makeService();

    const r1 = await makeProvisioningRequest(user, { requested_type: 'workspace', status: 'pending' });
    await makeProvisioningRequest(user, { requested_type: 'claude', status: 'approved' });
    const r3 = await makeProvisioningRequest(user, { requested_type: 'claude', status: 'pending' });

    const results = await svc.findPending();

    expect(results).toHaveLength(2);
    // oldest first
    expect(results[0].id).toBe(r1.id);
    expect(results[1].id).toBe(r3.id);
  });
});
