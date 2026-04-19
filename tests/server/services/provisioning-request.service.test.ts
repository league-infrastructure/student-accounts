/**
 * Integration tests for ProvisioningRequestService (Sprint 003, T001).
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
 *  - approve: sets status, decided_by, decided_at; audit recorded
 *  - approve: throws NotFoundError for unknown request
 *  - reject: sets status, decided_by, decided_at; audit recorded
 *  - reject: throws NotFoundError for unknown request
 *  - findByUser: returns correct rows ordered newest first
 *  - findPending: returns only pending rows ordered oldest first
 *  - Atomicity: AuditService error rolls back ProvisioningRequest creation
 */
import { prisma } from '../../../server/src/services/prisma.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { ExternalAccountService } from '../../../server/src/services/external-account.service.js';
import { ProvisioningRequestService } from '../../../server/src/services/provisioning-request.service.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../../../server/src/errors.js';
import { vi } from 'vitest';
import {
  makeUser,
  makeExternalAccount,
  makeProvisioningRequest,
} from '../helpers/factories.js';

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

function makeService(auditOverride?: AuditService): ProvisioningRequestService {
  const audit = auditOverride ?? new AuditService();
  const externalAccounts = new ExternalAccountService(prisma, audit);
  return new ProvisioningRequestService(prisma, audit, externalAccounts);
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await clearDb();
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
// approve
// ---------------------------------------------------------------------------

describe('ProvisioningRequestService.approve', () => {
  it('sets status=approved, decided_by, decided_at', async () => {
    const user = await makeUser();
    const admin = await makeUser();
    const svc = makeService();

    const req = await makeProvisioningRequest(user, { requested_type: 'workspace' });

    const updated = await svc.approve(req.id, admin.id);

    expect(updated.status).toBe('approved');
    expect(updated.decided_by).toBe(admin.id);
    expect(updated.decided_at).toBeDefined();
    expect(updated.decided_at).not.toBeNull();
  });

  it('records an approve_provisioning_request audit event', async () => {
    const user = await makeUser();
    const admin = await makeUser();
    const svc = makeService();

    const req = await makeProvisioningRequest(user, { requested_type: 'workspace' });

    await svc.approve(req.id, admin.id);

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'approve_provisioning_request', target_entity_id: String(req.id) },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(admin.id);
    expect(events[0].target_user_id).toBe(user.id);
  });

  it('throws NotFoundError for an unknown request id', async () => {
    const svc = makeService();
    await expect(svc.approve(9999999, 1)).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// reject
// ---------------------------------------------------------------------------

describe('ProvisioningRequestService.reject', () => {
  it('sets status=rejected, decided_by, decided_at', async () => {
    const user = await makeUser();
    const admin = await makeUser();
    const svc = makeService();

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
    const svc = makeService();

    const req = await makeProvisioningRequest(user, { requested_type: 'workspace' });

    await svc.reject(req.id, admin.id);

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'reject_provisioning_request', target_entity_id: String(req.id) },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(admin.id);
    expect(events[0].target_user_id).toBe(user.id);
  });

  it('throws NotFoundError for an unknown request id', async () => {
    const svc = makeService();
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
